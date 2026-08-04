"""
embed_to_csv_finetuned.py — same output shape as embed_to_csv.py (block_id,
space_version, embedding), but tailored to Silk instead of generic CLIP.

v1/v2 trained the projection head on image-image pairs: two blocks in the
same channel are a positive pair, CLIP-style, nothing else. That taught the
head "these two blocks were curated together" but never once involved what
the channel was actually *about* — so a text query like "drain gang" had
nothing trained to connect it to that channel's images. Verified: v1's loss
barely moved (image content within a channel can be wildly heterogeneous —
photos, memes, screenshots, no shared pixel structure), and v2's anchor term
(kept, see anchor_loss) couldn't fix a problem that was never about drift.

v3 uses the caption that was sitting right there unused: channels.csv's
`title` (e.g. "Drain Gang - Collection Archive"). Positive pairs are now
(channel title text, member image) — the exact same recipe CLIP itself was
pretrained on, just swapping "caption" for "channel title". This directly
teaches the model what a text query like "drain gang" should retrieve,
instead of hoping image-image clustering happens to transfer.

CLIP stays frozen (both towers). Only a small linear head on the image side
trains, and it trains directly on cached 512-dim vectors — no image forward
passes after the one-time corpus embed, no GPU required, done in seconds.

Usage:
  cd ml && uv run python embed_to_csv_finetuned.py
  uv run python embed_to_csv_finetuned.py --epochs 20 --out artifacts/channels-ft/embeddings.csv
"""
import argparse
import csv
import os
import random
from pathlib import Path

import pandas as pd
import torch
import torch.nn.functional as F
from torch import nn
from transformers import CLIPModel, CLIPProcessor

from retrieve import MODEL_NAME, embed_corpus, extract_features, get_device, load_channel_to_blocks

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_ROOT = Path(__file__).resolve().parent
HEAD_CACHE = ML_ROOT / "cache" / "projection_head.pt"

# v3: switched the training signal from image-image (channel co-membership)
# to image-text (channel title -> member image) — see module docstring.
# bump alongside the training setup below, same reason base_embeddings' name
# is versioned: old and new vectors must never get compared as the same space
DEFAULT_SPACE_VERSION = "clip-vit-base-patch32_channels-ft-v3"


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


def load_channel_captions(channels_csv) -> dict[int, str]:
    """channel id -> "title. description" (title alone when there's no
    description) — the caption CLIP's text tower embeds as this channel's
    anchor during training."""
    df = pd.read_csv(channels_csv, usecols=["id", "title", "description"])
    captions = {}
    for row in df.itertuples():
        title = row.title if isinstance(row.title, str) and row.title.strip() else None
        if not title:
            continue
        desc = row.description if isinstance(row.description, str) and row.description.strip() else None
        captions[int(row.id)] = f"{title}. {desc}" if desc else title
    return captions


def embed_channel_captions(captions: dict[int, str], processor, model, device) -> dict[int, torch.Tensor]:
    ids = list(captions.keys())
    with torch.inference_mode():
        inputs = processor(text=[captions[c] for c in ids], return_tensors="pt", padding=True, truncation=True).to(device)
        feats = extract_features(model.get_text_features(**inputs))
        feats = F.normalize(feats.to(torch.float32), dim=-1).cpu()
    return {c: feats[i] for i, c in enumerate(ids)}


def sample_batch(channel_indices, channel_text, eligible, channels_per_batch, rng):
    """One (member image, channel-title text) pair per sampled channel —
    every other channel's title in the batch stands in as a negative,
    exactly the recipe CLIP itself was pretrained on."""
    chosen = rng.sample(eligible, min(channels_per_batch, len(eligible)))
    img_idx = [rng.choice(channel_indices[c]) for c in chosen]
    text_batch = torch.stack([channel_text[c] for c in chosen])
    return torch.tensor(img_idx), text_batch


def nt_xent_loss(image_embeds, text_embeds, temperature):
    """CLIP's own loss, reused: for each image, its channel's title should
    score higher than every other channel's title in the batch, and vice
    versa."""
    logits = image_embeds @ text_embeds.T / temperature
    targets = torch.arange(len(image_embeds), device=logits.device)
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


def train_head(E, channel_to_blocks, id2idx, channel_captions, processor, model, epochs, steps_per_epoch, channels_per_batch, lr, temperature, anchor_weight, device, seed):
    rng = random.Random(seed)
    channel_indices = {
        c: [id2idx[b] for b in blocks if b in id2idx] for c, blocks in channel_to_blocks.items()
    }
    eligible_captioned = {c: cap for c, cap in channel_captions.items() if channel_indices.get(c)}
    if not eligible_captioned:
        raise SystemExit("no channel has both a title and >=1 block with a cached embedding — nothing to fine-tune on")
    print(f"{len(eligible_captioned)} channels usable (have a title and >=1 embedded member)")

    channel_text = embed_channel_captions(eligible_captioned, processor, model, device)
    eligible = list(eligible_captioned.keys())

    E = E.to(device)
    head = ProjectionHead(E.shape[1]).to(device)
    opt = torch.optim.Adam(head.parameters(), lr=lr)

    for epoch in range(epochs):
        total_nt, total_anchor = 0.0, 0.0
        for _ in range(steps_per_epoch):
            img_idx, text_batch = sample_batch(channel_indices, channel_text, eligible, channels_per_batch, rng)
            img_orig, text_batch = E[img_idx.to(device)], text_batch.to(device)
            opt.zero_grad()
            img_out = head(img_orig)
            nt_loss = nt_xent_loss(img_out, text_batch, temperature)
            drift = anchor_loss(img_out, img_orig)
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
    ap.add_argument("--channels-csv", default=str(REPO_ROOT / "channels.csv"))
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
        default=0.5,
        help="how strongly to penalize drifting from the original CLIP embedding — too high and it just reproduces frozen CLIP, too low and v2's uncalibrated-drift problem can come back",
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
    channel_captions = load_channel_captions(args.channels_csv)

    print("training projection head on channel title -> member image pairs...")
    head = train_head(
        E, channel_to_blocks, id2idx, channel_captions, processor, model,
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
