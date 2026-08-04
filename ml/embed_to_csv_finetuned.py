"""
embed_to_csv_finetuned.py — same output shape as embed_to_csv.py (block_id,
space_version, embedding), but tailored to Silk instead of generic CLIP.

Frozen CLIP knows what things look like, not what they mean to us. A photo of
a candle and a photo of a Bladee flyer aren't visually similar, but if they
live in the same channel, someone decided they're the same *idea* — that's
curation, and it's the one signal Silk actually has that off-the-shelf CLIP
doesn't. connections.csv (block_id, channel_id) is the label: two blocks in
the same channel are a positive pair, everything else in the batch is a
negative — the same contrastive setup CLIP itself was trained with, just
swapping "image, caption" for "block, channel-mate".

CLIP stays frozen. Only a small linear head on top of it trains, and it
trains directly on the cached 512-dim vectors from retrieve.py's cache — no
image forward passes, no GPU required, done in seconds.

Usage:
  cd ml && uv run python embed_to_csv_finetuned.py
  uv run python embed_to_csv_finetuned.py --epochs 20 --out artifacts/channels-ft/embeddings.csv
"""
import argparse
import csv
import os
import random
from pathlib import Path

import torch
import torch.nn.functional as F
from torch import nn
from transformers import CLIPModel, CLIPProcessor

from retrieve import MODEL_NAME, embed_corpus, get_device, load_channel_to_blocks

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_ROOT = Path(__file__).resolve().parent
HEAD_CACHE = ML_ROOT / "cache" / "projection_head.pt"

# v2: the channel-contrastive loss alone had no reason to stay anywhere near
# CLIP's original calibration between image and text embeddings — verified
# it drifted enough that fine-tuned image vectors scored higher against
# *arbitrary* text queries than the actual matching images did, regardless
# of relevance. v2 adds an anchor term (see train_head) to fix that; bump
# alongside the training setup below, same reason base_embeddings' name is
# versioned: old and new vectors must never get compared as the same space
DEFAULT_SPACE_VERSION = "clip-vit-base-patch32_channels-ft-v2"


class ProjectionHead(nn.Module):
    """One linear layer, identity-initialized so training starts from the
    base CLIP space and only bends it towards channel structure, rather than
    reinventing the space from a random init."""

    def __init__(self, dim: int = 512):
        super().__init__()
        self.linear = nn.Linear(dim, dim, bias=False)
        with torch.no_grad():
            self.linear.weight.copy_(torch.eye(dim))

    def forward(self, x):
        return F.normalize(self.linear(x), dim=-1)


def sample_pairs(channel_indices, eligible, channels_per_batch, rng):
    """One (anchor, positive) pair per sampled channel — two blocks a curator
    put in the same channel. Everything else in the batch stands in as
    negatives, CLIP-style."""
    chosen = rng.sample(eligible, min(channels_per_batch, len(eligible)))
    anchors, positives = [], []
    for c in chosen:
        a, p = rng.sample(channel_indices[c], 2)
        anchors.append(a)
        positives.append(p)
    return torch.tensor(anchors), torch.tensor(positives)


def nt_xent_loss(anchor_embeds, positive_embeds, temperature):
    """CLIP's own loss, reused: for each anchor, its channel-mate should
    score higher than every other block in the batch, in both directions."""
    logits = anchor_embeds @ positive_embeds.T / temperature
    targets = torch.arange(len(anchor_embeds), device=logits.device)
    return (F.cross_entropy(logits, targets) + F.cross_entropy(logits.T, targets)) / 2


def anchor_loss(projected, original):
    """Penalize drifting away from the block's own frozen-CLIP position.
    nt_xent alone is free to rotate the space however it likes to separate
    channels — including directions that just happen to sit closer to
    arbitrary CLIP text embeddings for no semantic reason, which is exactly
    what made magic search on the fine-tuned space return "sunset"/"y2k"/
    "moodboard" results with no relevance to the query. Both are already
    unit vectors, so cosine similarity is a plain dot product."""
    return 1 - (projected * original).sum(dim=-1).mean()


def train_head(E, channel_to_blocks, id2idx, epochs, steps_per_epoch, channels_per_batch, lr, temperature, anchor_weight, device, seed):
    rng = random.Random(seed)
    channel_indices = {
        c: [id2idx[b] for b in blocks if b in id2idx] for c, blocks in channel_to_blocks.items()
    }
    eligible = [c for c, idxs in channel_indices.items() if len(idxs) >= 2]
    if not eligible:
        raise SystemExit("no channel has >=2 blocks with cached embeddings — nothing to fine-tune on")
    print(f"{len(eligible)} channels usable as positive-pair sources")

    E = E.to(device)
    head = ProjectionHead(E.shape[1]).to(device)
    opt = torch.optim.Adam(head.parameters(), lr=lr)

    for epoch in range(epochs):
        total_nt, total_anchor = 0.0, 0.0
        for _ in range(steps_per_epoch):
            anchor_idx, positive_idx = sample_pairs(channel_indices, eligible, channels_per_batch, rng)
            anchor_orig, positive_orig = E[anchor_idx.to(device)], E[positive_idx.to(device)]
            opt.zero_grad()
            anchor_out, positive_out = head(anchor_orig), head(positive_orig)
            nt_loss = nt_xent_loss(anchor_out, positive_out, temperature)
            drift = (anchor_loss(anchor_out, anchor_orig) + anchor_loss(positive_out, positive_orig)) / 2
            loss = nt_loss + anchor_weight * drift
            loss.backward()
            opt.step()
            total_nt += nt_loss.item()
            total_anchor += drift.item()
        print(f"  epoch {epoch + 1}/{epochs}  nt_xent {total_nt / steps_per_epoch:.4f}  anchor_drift {total_anchor / steps_per_epoch:.4f}")

    return head.cpu().eval()


def format_vector(vec) -> str:
    return " ".join(f"{x:.7f}" for x in vec.tolist())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks-csv", default=str(REPO_ROOT / "blocks.csv"))
    ap.add_argument("--connections-csv", default=str(REPO_ROOT / "connections.csv"))
    ap.add_argument(
        "--image-dir",
        default=os.environ.get("SILK_IMAGE_DIR", "/mnt/scratch/linpaul1/micro-silk/images"),
    )
    ap.add_argument("--space-version", default=DEFAULT_SPACE_VERSION)
    ap.add_argument("--out", default=None, help="defaults to ml/artifacts/<space-version>/embeddings.csv")
    ap.add_argument("--rebuild", action="store_true", help="recompute base CLIP embeddings instead of using the cache")
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--steps-per-epoch", type=int, default=200)
    ap.add_argument("--channels-per-batch", type=int, default=64, help="= batch size, one pair per channel")
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--temperature", type=float, default=0.1)
    ap.add_argument(
        "--anchor-weight",
        type=float,
        default=2.0,
        help="how strongly to penalize drifting from the original CLIP embedding — 0 reproduces the old (uncalibrated) behavior",
    )
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    out_path = Path(args.out) if args.out else ML_ROOT / "artifacts" / args.space_version / "embeddings.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    device = get_device()
    print(f"device: {device}")

    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)

    E, ids = embed_corpus(args.blocks_csv, Path(args.image_dir), processor, model, device, args.rebuild)
    id2idx = {block_id: i for i, block_id in enumerate(ids)}
    channel_to_blocks = load_channel_to_blocks(args.connections_csv, id2idx)

    print("training projection head on channel co-membership...")
    head = train_head(
        E, channel_to_blocks, id2idx,
        args.epochs, args.steps_per_epoch, args.channels_per_batch, args.lr, args.temperature,
        args.anchor_weight, device, args.seed,
    )

    HEAD_CACHE.parent.mkdir(exist_ok=True)
    torch.save({"state_dict": head.state_dict(), "base_model": MODEL_NAME, "space_version": args.space_version}, HEAD_CACHE)
    print(f"saved projection head to {HEAD_CACHE}")

    with torch.no_grad():
        fine_tuned = head(E)

    print(f"embedded {len(ids)} blocks — writing to {out_path}")
    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["block_id", "space_version", "embedding"])
        for block_id, vec in zip(ids, fine_tuned):
            writer.writerow([block_id, args.space_version, format_vector(vec)])

    print("done.")


if __name__ == "__main__":
    main()
