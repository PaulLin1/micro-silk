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

v3 still overfit: every step sampled exactly *one* random member image per
channel, so a channel with a recurring visual subtype (a merch shirt photo
reposted a dozen times in "Drain Gang") got that subtype reinforced on a
large fraction of the steps that touched it, at the expense of the channel's
actually-diverse content. Nothing regularized against this, and there was no
way to even tell it was happening beyond eyeballing a 9-image grid. v4 fixes
all three:
  - each step samples --images-per-channel members per channel (not 1), so a
    single recurring image can't dominate that step's gradient
  - Adam gets weight decay, to discourage the head from carving out a narrow
    direction that fits one frequent subtype
  - a held-out split: --val-fraction of each channel's members are *never*
    trained on, then recall@k is reported for train vs. held-out members
    separately at the end. Train-high/held-out-low is the actual, measured
    signature of overfitting — not a symptom you have to eyeball.

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

# v4: multi-image sampling + weight decay against overfitting to a channel's
# most-repeated visual subtype — see module docstring. bump alongside the
# training setup below, same reason base_embeddings' name is versioned: old
# and new vectors must never get compared as the same space
DEFAULT_SPACE_VERSION = "clip-vit-base-patch32_channels-ft-v4"


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


def sample_batch(channel_indices, channel_text, eligible, channels_per_batch, images_per_channel, rng):
    """--images-per-channel member images per sampled channel (not 1) — a
    single recurring visual subtype (a shirt photo reposted a dozen times)
    can dominate one image's worth of gradient, but not several at once,
    since the loss below averages over all of them. Every other sampled
    channel's title stands in as a negative, CLIP-style."""
    chosen = rng.sample(eligible, min(channels_per_batch, len(eligible)))
    img_idx, text_rows = [], []
    for c in chosen:
        members = channel_indices[c]
        picks = rng.sample(members, min(images_per_channel, len(members)))
        img_idx.extend(picks)
        text_rows.extend([channel_text[c]] * len(picks))
    return torch.tensor(img_idx), torch.stack(text_rows)


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


def split_train_val(channel_indices, val_fraction, min_members_to_hold_out, rng):
    """Hold out val_fraction of each channel's members from training entirely
    — small channels (< min_members_to_hold_out) skip this and go fully into
    train, since holding out their one or two images leaves nothing to learn
    from and nothing meaningful to evaluate either."""
    train, val = {}, {}
    for c, idxs in channel_indices.items():
        if len(idxs) < min_members_to_hold_out:
            train[c] = idxs
            continue
        shuffled = idxs[:]
        rng.shuffle(shuffled)
        n_val = max(1, round(len(shuffled) * val_fraction))
        val[c] = shuffled[:n_val]
        train[c] = shuffled[n_val:]
    return train, val


@torch.no_grad()
def evaluate_recall(head, E, channel_text, train_indices, val_indices, k, device):
    """The actual overfitting test: rank the whole corpus against each
    channel's title and check whether that channel's own images show up in
    the top k — separately for images the head trained on (train) vs. images
    it never saw (held-out). Train-high/held-out-low means it memorized
    specific images (or a subtype like "shirt photos") rather than learning
    what the channel is about; train and held-out tracking close together
    means it generalized."""
    E_proj = F.normalize(head(E.to(device)), dim=-1)
    train_recalls, val_recalls = [], []
    for c, val_idxs in val_indices.items():
        if not val_idxs:
            continue
        scores = E_proj @ channel_text[c].to(device)
        topk = set(scores.topk(min(k, len(scores))).indices.tolist())
        val_recalls.append(sum(i in topk for i in val_idxs) / len(val_idxs))
        train_idxs = train_indices.get(c, [])
        if train_idxs:
            train_recalls.append(sum(i in topk for i in train_idxs) / len(train_idxs))
    return train_recalls, val_recalls


def train_head(E, channel_to_blocks, id2idx, channel_captions, processor, model, epochs, steps_per_epoch, channels_per_batch, images_per_channel, lr, weight_decay, temperature, anchor_weight, val_fraction, eval_k, device, seed):
    rng = random.Random(seed)
    channel_indices = {
        c: [id2idx[b] for b in blocks if b in id2idx] for c, blocks in channel_to_blocks.items()
    }
    eligible_captioned = {c: cap for c, cap in channel_captions.items() if channel_indices.get(c)}
    if not eligible_captioned:
        raise SystemExit("no channel has both a title and >=1 block with a cached embedding — nothing to fine-tune on")
    print(f"{len(eligible_captioned)} channels usable (have a title and >=1 embedded member)")

    channel_text = embed_channel_captions(eligible_captioned, processor, model, device)
    train_indices, val_indices = split_train_val(
        {c: channel_indices[c] for c in eligible_captioned}, val_fraction, min_members_to_hold_out=5, rng=rng
    )
    eligible = [c for c, idxs in train_indices.items() if idxs]
    n_held_out = sum(len(v) for v in val_indices.values())
    print(f"held out {n_held_out} member images across {len(val_indices)} channels for evaluation (never trained on)")

    E = E.to(device)
    head = ProjectionHead(E.shape[1]).to(device)
    opt = torch.optim.Adam(head.parameters(), lr=lr, weight_decay=weight_decay)

    for epoch in range(epochs):
        total_nt, total_anchor = 0.0, 0.0
        for _ in range(steps_per_epoch):
            img_idx, text_batch = sample_batch(train_indices, channel_text, eligible, channels_per_batch, images_per_channel, rng)
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

    head.eval()
    train_recalls, val_recalls = evaluate_recall(head, E, channel_text, train_indices, val_indices, eval_k, device)
    if val_recalls:
        mean = lambda xs: sum(xs) / len(xs)
        print(
            f"recall@{eval_k}: train members {mean(train_recalls):.1%} "
            f"vs. held-out members {mean(val_recalls):.1%}"
            f"{' — held-out is much lower, this is still overfitting' if mean(val_recalls) < mean(train_recalls) * 0.5 else ''}"
        )

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
    ap.add_argument("--channels-per-batch", type=int, default=32, help="distinct channels sampled per step")
    ap.add_argument(
        "--images-per-channel",
        type=int,
        default=4,
        help="member images sampled per channel per step — >1 so one recurring visual subtype (e.g. a reposted shirt photo) can't dominate a step's gradient",
    )
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--weight-decay", type=float, default=1e-4, help="Adam weight decay on the projection head, against overfitting to a narrow direction")
    ap.add_argument("--temperature", type=float, default=0.1)
    ap.add_argument(
        "--anchor-weight",
        type=float,
        default=0.5,
        help="how strongly to penalize drifting from the original CLIP embedding — too high and it just reproduces frozen CLIP, too low and v2's uncalibrated-drift problem can come back",
    )
    ap.add_argument(
        "--val-fraction",
        type=float,
        default=0.2,
        help="fraction of each (large enough) channel's members held out from training, for the train-vs-held-out recall check",
    )
    ap.add_argument("--eval-k", type=int, default=50, help="recall@k cutoff for the held-out evaluation")
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
        args.epochs, args.steps_per_epoch, args.channels_per_batch, args.images_per_channel,
        args.lr, args.weight_decay, args.temperature, args.anchor_weight,
        args.val_fraction, args.eval_k, device, args.seed,
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
