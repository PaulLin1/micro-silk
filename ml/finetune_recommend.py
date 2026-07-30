"""
finetune_recommend.py — simple CLIP-for-recommendation demo.

Idea: two blocks that sit in the same are.na channel are "similar" — that's free
supervision, no labels needed. We freeze CLIP entirely and train a tiny residual
head on top of its image embeddings with a supervised-contrastive loss, using
channel co-membership as the positive signal. A handful of channels are held out
completely so the headline number ("does it recommend the right channel's blocks
for images it never saw during training") is real, not memorized.

Pipeline (all in this one file, meant to run on the GPU box):
  1. load channels.csv / connections.csv / blocks.csv
  2. keep blocks whose image actually downloaded to disk
  3. hold out --demo-channels completely (never trained on) as train/held-out split
  4. embed every used block ONCE with frozen CLIP (cached to disk)
  5. train a small residual head with supervised-contrastive loss
     (batches built as: sample K channels, sample M blocks per channel —
     this naturally oversamples small channels for free)
  6. eval: held-out-channel retrieval hit_rate@10, baseline CLIP vs trained head
  7. save head weights + one before/after recommendation grid per demo channel

Usage:
  cd ml && uv run python finetune_recommend.py
  uv run python finetune_recommend.py --demo-channels "vaporwave,cottagecore"   # pick your own aesthetics
  uv run python finetune_recommend.py --steps 50 --min-channel-blocks 10        # quick smoke test
"""
import argparse
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import CLIPModel, CLIPProcessor

try:
    import matplotlib.pyplot as plt
    HAS_PLOTTING = True
except ImportError:
    HAS_PLOTTING = False

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = "openai/clip-vit-base-patch32"
OUT_DIR = Path(__file__).resolve().parent / "recommend_demo"
CACHE_DIR = Path(__file__).resolve().parent / "cache"


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ---------------------------------------------------------------- data

def load_channel_graph(channels_csv, connections_csv, blocks_csv, image_dir, min_channel_blocks):
    channels = pd.read_csv(channels_csv, usecols=["id", "title"])
    channel_title = dict(zip(channels.id, channels.title))

    conn = pd.read_csv(connections_csv, usecols=["block_id", "channel_id"])

    blocks = pd.read_csv(blocks_csv, usecols=["id"])
    on_disk = {int(p.stem) for p in image_dir.glob("*.jpg")} if image_dir.exists() else set()
    have_image = set(blocks.id) & on_disk
    print(f"blocks in csv: {len(blocks)}, images on disk matching: {len(have_image)}")

    conn = conn[conn.block_id.isin(have_image)]
    channel_to_blocks = conn.groupby("channel_id")["block_id"].apply(list).to_dict()
    channel_to_blocks = {c: b for c, b in channel_to_blocks.items() if len(b) >= min_channel_blocks}
    print(f"channels with >= {min_channel_blocks} downloaded blocks: {len(channel_to_blocks)}")

    return channel_to_blocks, channel_title


def split_channels(channel_to_blocks, holdout_frac, seed):
    rng = np.random.default_rng(seed)
    channel_ids = sorted(channel_to_blocks.keys())
    rng.shuffle(channel_ids)
    n_holdout = max(1, int(len(channel_ids) * holdout_frac))
    holdout = set(channel_ids[:n_holdout])
    train = set(channel_ids[n_holdout:])
    return train, holdout


def resolve_channels(spec, channel_title, channel_to_blocks):
    """Resolve a comma-separated list of channel titles (substring match,
    case-insensitive) or literal channel ids to channel ids, restricted to
    channels that survived the min-blocks/has-images filter. Prints which
    channel got picked so a fuzzy title match isn't silently wrong."""
    resolved = []
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        if token.isdigit():
            cid = int(token)
            if cid not in channel_to_blocks:
                raise SystemExit(f"--demo-channels: channel id {cid} has no usable blocks (missing images or below --min-channel-blocks)")
            resolved.append(cid)
            continue
        candidates = [
            cid for cid in channel_to_blocks
            if token.lower() in str(channel_title.get(cid, "")).lower()
        ]
        if not candidates:
            raise SystemExit(f"--demo-channels: no channel title matching {token!r} (after filtering to channels with images / >= --min-channel-blocks)")
        best = max(candidates, key=lambda c: len(channel_to_blocks[c]))
        picked = f"#{best} {channel_title[best]!r} ({len(channel_to_blocks[best])} blocks)"
        if len(candidates) > 1:
            print(f"  {token!r} matched {len(candidates)} channels, using largest: {picked}")
        else:
            print(f"  {token!r} -> {picked}")
        resolved.append(best)
    return resolved


# ---------------------------------------------------------------- CLIP embedding (frozen, once)

class ImageDataset(Dataset):
    def __init__(self, ids, image_dir, processor):
        self.ids = ids
        self.image_dir = image_dir
        self.processor = processor

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, idx):
        block_id = self.ids[idx]
        try:
            img = Image.open(self.image_dir / f"{block_id}.jpg").convert("RGB")
        except Exception:
            img = Image.new("RGB", (224, 224))
        return self.processor(images=img, return_tensors="pt")["pixel_values"][0], block_id


def collate(batch):
    return torch.stack([b[0] for b in batch]), [b[1] for b in batch]


def extract_features(output):
    """get_image_features returns a bare Tensor on transformers 4.x and a
    BaseModelOutputWithPooling on 5.x — already projected either way."""
    return output.pooler_output if hasattr(output, "pooler_output") else output


def embed_blocks(ids, image_dir, processor, model, device, rebuild):
    ids = sorted(set(ids))
    cache_key = hashlib.sha1(",".join(map(str, ids)).encode()).hexdigest()[:16]
    cache_path = CACHE_DIR / f"embeddings_{cache_key}.pt"
    if cache_path.exists() and not rebuild:
        data = torch.load(cache_path)
        print(f"loaded cached embeddings: {len(data['ids'])} blocks ({cache_path.name})")
        return data["embeddings"], data["ids"]

    print(f"embedding {len(ids)} blocks with frozen CLIP...")
    loader = DataLoader(ImageDataset(ids, image_dir, processor), batch_size=128, num_workers=4, collate_fn=collate)
    embeds, out_ids = [], []
    with torch.inference_mode():
        for i, (pixel_values, batch_ids) in enumerate(loader):
            feats = extract_features(model.get_image_features(pixel_values=pixel_values.to(device)))
            feats = F.normalize(feats.to(torch.float32), dim=-1).cpu()
            embeds.append(feats)
            out_ids.extend(batch_ids)
            print(f"  batch {i+1}/{len(loader)} ({len(out_ids)}/{len(ids)})")

    embeddings = torch.cat(embeds, dim=0)
    CACHE_DIR.mkdir(exist_ok=True)
    torch.save({"embeddings": embeddings, "ids": out_ids, "model": MODEL_NAME}, cache_path)
    return embeddings, out_ids


# ---------------------------------------------------------------- head + loss

class Head(nn.Module):
    """z = normalize(x + mlp(x)); mlp's final layer is zero-init so at step 0
    this is exactly the identity — training starts from the CLIP baseline and
    every reported number afterward is a measured delta, not noise."""

    def __init__(self, dim=512, hidden=1024):
        super().__init__()
        self.fc1 = nn.Linear(dim, hidden)
        self.fc2 = nn.Linear(hidden, dim)
        nn.init.zeros_(self.fc2.weight)
        nn.init.zeros_(self.fc2.bias)

    def forward(self, x):
        h = self.fc2(F.gelu(self.fc1(x)))
        return F.normalize(x + h, dim=-1)


def supcon_loss(z, labels, temperature=0.1):
    """Supervised contrastive loss: all same-channel blocks in the batch are
    mutual positives, everything else is a negative."""
    sim = z @ z.T / temperature
    n = z.shape[0]
    self_mask = torch.eye(n, dtype=torch.bool, device=z.device)
    sim = sim.masked_fill(self_mask, float("-inf"))

    pos_mask = (labels.unsqueeze(0) == labels.unsqueeze(1)) & ~self_mask
    log_denom = torch.logsumexp(sim, dim=1, keepdim=True)
    log_prob = sim - log_denom
    # diagonal of log_prob is -inf (masked earlier) and pos_mask is False there —
    # multiplying would compute 0 * -inf = nan, so select with `where` instead.
    masked_log_prob = torch.where(pos_mask, log_prob, torch.zeros_like(log_prob))
    mean_log_prob_pos = masked_log_prob.sum(1) / pos_mask.sum(1).clamp(min=1)
    return -mean_log_prob_pos.mean()


def sample_batch(channel_to_blocks, channel_ids, k_channels, m_per_channel, rng):
    chosen = rng.choice(channel_ids, size=min(k_channels, len(channel_ids)), replace=False)
    ids, labels = [], []
    for label, ch in enumerate(chosen):
        blocks = channel_to_blocks[ch]
        replace = len(blocks) < m_per_channel
        sel = rng.choice(blocks, size=m_per_channel, replace=replace)
        ids.extend(int(x) for x in sel)
        labels.extend([label] * m_per_channel)
    return ids, labels


# ---------------------------------------------------------------- eval

def hit_rate_at_k(z, block_channel, k=10):
    """For each block, do its top-k nearest neighbours (by cosine sim) share
    its channel? z must already be L2-normalized."""
    sim = z @ z.T
    sim.fill_diagonal_(float("-inf"))
    topk = sim.topk(min(k, z.shape[0] - 1), dim=1).indices
    labels = torch.tensor([block_channel[i] for i in range(z.shape[0])], device=z.device)
    hits = (labels[topk] == labels.unsqueeze(1)).float().mean(dim=1)
    return hits.mean().item()


def eval_holdout(E, id2idx, channel_to_blocks, holdout_channels, head, device, k=10):
    ids, block_channel = [], {}
    for ch in holdout_channels:
        for b in channel_to_blocks[ch]:
            idx = len(ids)
            ids.append(b)
            block_channel[idx] = ch
    x = E[[id2idx[i] for i in ids]].to(device)
    with torch.inference_mode():
        z = x if head is None else head(x)
    return hit_rate_at_k(z, block_channel, k=k), ids


# ---------------------------------------------------------------- demo grid

def save_comparison_grid(anchor_id, baseline_ids, tuned_ids, image_dir, title, out_path):
    if not HAS_PLOTTING:
        return
    fig, axes = plt.subplots(2, len(baseline_ids), figsize=(2.2 * len(baseline_ids), 5))
    for row, (label, ids) in enumerate([("CLIP baseline", baseline_ids), ("fine-tuned", tuned_ids)]):
        for col, block_id in enumerate(ids):
            ax = axes[row][col]
            try:
                ax.imshow(Image.open(image_dir / f"{block_id}.jpg").convert("RGB"))
            except Exception:
                pass
            ax.axis("off")
            if col == 0:
                ax.set_ylabel(label, fontsize=9)
        axes[row][0].axis("on")
        axes[row][0].set_xticks([])
        axes[row][0].set_yticks([])
        axes[row][0].set_ylabel(label, fontsize=10)
    fig.suptitle(f"query block {anchor_id}: {title}")
    fig.tight_layout()
    fig.savefig(out_path, dpi=100)
    plt.close(fig)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels-csv", default=str(REPO_ROOT / "channels.csv"))
    ap.add_argument("--connections-csv", default=str(REPO_ROOT / "connections.csv"))
    ap.add_argument("--blocks-csv", default=str(REPO_ROOT / "blocks.csv"))
    ap.add_argument("--image-dir", default="/mnt/scratch/linpaul1/micro-silk/images")
    ap.add_argument("--min-channel-blocks", type=int, default=20)
    ap.add_argument("--max-per-channel", type=int, default=150, help="cap blocks used per channel, keeps embedding step bounded")
    ap.add_argument("--holdout-frac", type=float, default=0.15, help="used only when --demo-channels is empty")
    ap.add_argument(
        "--demo-channels", default="drain gang,y2k,grunge,brutalist",
        help="comma-separated channel titles (substring match) or numeric channel ids to hold out "
             "completely and demo — these are never trained on. Pass '' to fall back to a random "
             "--holdout-frac split instead of naming channels.",
    )
    ap.add_argument("--steps", type=int, default=300)
    ap.add_argument("--eval-every", type=int, default=25)
    ap.add_argument("--batch-channels", type=int, default=8)
    ap.add_argument("--per-channel", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--temperature", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--rebuild-embeddings", action="store_true")
    ap.add_argument("--num-demo-grids", type=int, default=4)
    args = ap.parse_args()

    device = get_device()
    print(f"device: {device}")
    rng = np.random.default_rng(args.seed)

    image_dir = Path(args.image_dir)
    channel_to_blocks, channel_title = load_channel_graph(
        args.channels_csv, args.connections_csv, args.blocks_csv, image_dir, args.min_channel_blocks,
    )
    if not channel_to_blocks:
        raise SystemExit("no channels with enough downloaded images — check --image-dir")

    if args.max_per_channel:
        channel_to_blocks = {
            ch: (blocks if len(blocks) <= args.max_per_channel
                 else list(rng.choice(blocks, size=args.max_per_channel, replace=False)))
            for ch, blocks in channel_to_blocks.items()
        }

    if args.demo_channels.strip():
        print(f"resolving --demo-channels {args.demo_channels!r}:")
        demo_channel_ids = resolve_channels(args.demo_channels, channel_title, channel_to_blocks)
        holdout_channels = set(demo_channel_ids)
        train_channels = set(channel_to_blocks) - holdout_channels
    else:
        demo_channel_ids = None
        train_channels, holdout_channels = split_channels(channel_to_blocks, args.holdout_frac, args.seed)
    print(f"train channels: {len(train_channels)}, held-out channels: {len(holdout_channels)}")

    all_ids = [b for ch in channel_to_blocks for b in channel_to_blocks[ch]]

    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)

    E, ids_order = embed_blocks(all_ids, image_dir, processor, model, device, args.rebuild_embeddings)
    id2idx = {block_id: i for i, block_id in enumerate(ids_order)}

    head = Head().to(device)
    opt = torch.optim.Adam(head.parameters(), lr=args.lr)

    baseline_hit, _ = eval_holdout(E, id2idx, channel_to_blocks, holdout_channels, head=None, device=device)
    print(f"\n[baseline CLIP]   held-out channel hit_rate@10 = {baseline_hit:.4f}")

    train_channel_list = sorted(train_channels)
    for step in range(1, args.steps + 1):
        ids, labels = sample_batch(channel_to_blocks, train_channel_list, args.batch_channels, args.per_channel, rng)
        x = E[[id2idx[i] for i in ids]].to(device)
        labels_t = torch.tensor(labels, device=device)

        z = head(x)
        loss = supcon_loss(z, labels_t, temperature=args.temperature)
        opt.zero_grad()
        loss.backward()
        opt.step()

        if step % args.eval_every == 0 or step == args.steps:
            hit, _ = eval_holdout(E, id2idx, channel_to_blocks, holdout_channels, head=head, device=device)
            print(f"step {step:4d}/{args.steps}  loss={loss.item():.4f}  held-out hit_rate@10={hit:.4f}")

    final_hit, holdout_ids = eval_holdout(E, id2idx, channel_to_blocks, holdout_channels, head=head, device=device)
    print(f"\n[fine-tuned head] held-out channel hit_rate@10 = {final_hit:.4f}  (baseline was {baseline_hit:.4f})")

    OUT_DIR.mkdir(exist_ok=True)
    torch.save(head.state_dict(), OUT_DIR / "head.pt")
    print(f"saved head weights to {OUT_DIR / 'head.pt'}")

    # before/after recommendation grids on held-out channels — use the named
    # channels in the order given, or fall back to a random sample of the holdout
    if demo_channel_ids is not None:
        demo_channels = demo_channel_ids
    else:
        demo_channels = rng.choice(sorted(holdout_channels), size=min(args.num_demo_grids, len(holdout_channels)), replace=False)
    with torch.inference_mode():
        Z = head(E.to(device)).cpu()
    for ch in demo_channels:
        blocks = channel_to_blocks[ch]
        if len(blocks) < 4:
            continue
        anchor = int(rng.choice(blocks))
        anchor_idx = id2idx[anchor]

        base_sim = E @ E[anchor_idx]
        base_sim[anchor_idx] = -1
        base_top = base_sim.topk(4).indices.tolist()
        base_ids = [ids_order[i] for i in base_top]

        tuned_sim = Z @ Z[anchor_idx]
        tuned_sim[anchor_idx] = -1
        tuned_top = tuned_sim.topk(4).indices.tolist()
        tuned_ids = [ids_order[i] for i in tuned_top]

        save_comparison_grid(
            anchor, base_ids, tuned_ids, image_dir,
            channel_title.get(ch, f"channel {ch}"),
            OUT_DIR / f"compare_{anchor}.png",
        )
    print(f"saved comparison grids to {OUT_DIR}/")


if __name__ == "__main__":
    main()
