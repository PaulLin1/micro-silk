"""
retrieve.py — the "build now" retrieval layer, no fine-tuning, no training.

One off-the-shelf CLIP embedding per block, brute-force cosine nearest-neighbor
over it, for three query types:

  --text "drain gang"     Magic Search: text -> item
  --item <block_id>       "you might also connect": item -> item
  --channel <channel_id>  board-centroid recommend: given a Web, what fits it?
                           (centroid of its members' embeddings -> nearest
                           blocks NOT already in it)

`connections.csv` (block_id, channel_id) is already the interaction graph —
nothing to build there, channel_search() below just reads it directly. There
is no user tower here yet: a channel's centroid is standing in for it, which
is the simplest possible "two-tower" — swap in a real per-user tower later
without touching this file's retrieval logic.

Usage:
  cd ml && uv run python retrieve.py --text "drain gang" --grid
  uv run python retrieve.py --item 133329 --grid
  uv run python retrieve.py --channel 9 --grid
"""
import argparse
from pathlib import Path

import pandas as pd
import torch
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
CACHE_PATH = Path(__file__).resolve().parent / "cache" / "base_embeddings.pt"
# written by embed_to_csv_finetuned.py's train_head() — not imported from
# there directly, since that module imports *from* this one
HEAD_CACHE_PATH = Path(__file__).resolve().parent / "cache" / "projection_head.pt"
OUT_DIR = Path(__file__).resolve().parent / "retrieve_demo"


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def extract_features(output):
    """get_*_features returns a bare Tensor on transformers 4.x and a
    BaseModelOutputWithPooling on 5.x — already projected either way."""
    return output.pooler_output if hasattr(output, "pooler_output") else output


# ---------------------------------------------------------------- embed the corpus (once)

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


def embed_corpus(blocks_csv, image_dir, processor, model, device, rebuild):
    blocks = pd.read_csv(blocks_csv, usecols=["id"])

    if CACHE_PATH.exists() and not rebuild:
        data = torch.load(CACHE_PATH, weights_only=False)
        if data.get("model") == MODEL_NAME:
            print(f"loaded cached embeddings: {len(data['ids'])} blocks")
            # the cache freezes whatever image_dir had on disk the day it was
            # built — a later image download (or a new channel entirely, like
            # the drain-gang one that shipped with 0 embeddings for months
            # because nobody re-ran with --rebuild) silently stays invisible
            # to every script that shares this cache until someone notices.
            missing = len(blocks) - len(data["ids"])
            if missing > 0.02 * len(blocks):
                print(
                    f"WARNING: cache covers {len(data['ids'])}/{len(blocks)} blocks.csv rows "
                    f"({missing} missing, {missing / len(blocks):.1%}) — if images were downloaded "
                    f"since this cache was built, pass --rebuild to pick them up"
                )
            return data["embeddings"], data["ids"]

    ids = sorted(int(i) for i in blocks.id if (image_dir / f"{int(i)}.jpg").exists())
    missing = len(blocks) - len(ids)
    print(f"embedding {len(ids)} blocks with frozen CLIP (no fine-tuning)...")
    if missing:
        print(f"WARNING: {missing}/{len(blocks)} blocks.csv rows have no local image file under {image_dir} — skipped, not an error")

    loader = DataLoader(ImageDataset(ids, image_dir, processor), batch_size=2048, num_workers=4, collate_fn=collate)
    embeds, out_ids = [], []
    with torch.inference_mode():
        for i, (pixel_values, batch_ids) in enumerate(loader):
            feats = extract_features(model.get_image_features(pixel_values=pixel_values.to(device)))
            feats = F.normalize(feats.to(torch.float32), dim=-1).cpu()
            embeds.append(feats)
            out_ids.extend(batch_ids)
            print(f"  batch {i+1}/{len(loader)} ({len(out_ids)}/{len(ids)})")

    embeddings = torch.cat(embeds, dim=0)
    CACHE_PATH.parent.mkdir(exist_ok=True)
    torch.save({"embeddings": embeddings, "ids": out_ids, "model": MODEL_NAME}, CACHE_PATH)
    return embeddings, out_ids


def apply_finetuned_head(E):
    """Reproject frozen-CLIP embeddings through the trained channel-contrastive
    head, so --space finetuned can be tested here — offline, against a saved
    grid image — before ever touching Postgres or the website."""
    if not HEAD_CACHE_PATH.exists():
        raise SystemExit(
            f"no trained projection head at {HEAD_CACHE_PATH} — run embed_to_csv_finetuned.py first"
        )
    ckpt = torch.load(HEAD_CACHE_PATH, weights_only=False)
    print(f"applying projection head trained for space_version={ckpt.get('space_version')!r}")
    sd = ckpt["state_dict"]
    if "linear.weight" in sd:
        # v2/v4 and earlier: plain linear map, no bias
        return F.normalize(E @ sd["linear.weight"].T, dim=-1)
    # v5+: residual bottleneck adapter — mirrors ProjectionHead.forward exactly
    hidden = F.gelu(E @ sd["fc1.weight"].T + sd["fc1.bias"])
    residual = hidden @ sd["fc2.weight"].T + sd["fc2.bias"]
    return F.normalize(E + residual, dim=-1)


def load_channel_to_blocks(connections_csv, id2idx):
    conn = pd.read_csv(connections_csv, usecols=["block_id", "channel_id"])
    conn = conn[conn.block_id.isin(id2idx)]
    return conn.groupby("channel_id")["block_id"].apply(lambda s: [int(b) for b in s]).to_dict()


# ---------------------------------------------------------------- the three retrieval modes

def text_search(query, E, ids, processor, model, device, k):
    with torch.inference_mode():
        inputs = processor(text=[query], return_tensors="pt", padding=True).to(device)
        feat = extract_features(model.get_text_features(**inputs))
        feat = F.normalize(feat.to(torch.float32), dim=-1).cpu()
    scores = (E @ feat.T).squeeze(1)
    top = scores.topk(min(k, len(ids)))
    return [(ids[i], top.values[j].item()) for j, i in enumerate(top.indices.tolist())]


def item_search(block_id, E, ids, id2idx, k):
    if block_id not in id2idx:
        raise SystemExit(f"block {block_id} has no cached embedding (missing image on disk?)")
    idx = id2idx[block_id]
    scores = E @ E[idx]
    scores[idx] = -1  # exclude the query itself
    top = scores.topk(min(k, len(ids) - 1))
    return [(ids[i], top.values[j].item()) for j, i in enumerate(top.indices.tolist())]


def channel_search(channel_id, E, ids, id2idx, channel_to_blocks, k):
    if channel_id not in channel_to_blocks:
        raise SystemExit(f"channel {channel_id} has no blocks with cached embeddings")
    members = channel_to_blocks[channel_id]
    member_idx = [id2idx[b] for b in members if b in id2idx]
    centroid = F.normalize(E[member_idx].mean(dim=0, keepdim=True), dim=-1).squeeze(0)

    scores = E @ centroid
    for idx in member_idx:
        scores[idx] = -1  # don't recommend blocks already in the channel
    top = scores.topk(min(k, len(ids) - len(member_idx)))
    return [(ids[i], top.values[j].item()) for j, i in enumerate(top.indices.tolist())]


# ---------------------------------------------------------------- demo grid

def save_result_grid(results, title, image_dir, out_path):
    if not HAS_PLOTTING:
        print(f"(matplotlib not installed — skipping grid for {title!r})")
        return
    n = len(results)
    cols = 3
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(9, 3 * rows))
    axes = axes.flatten() if n > 1 else [axes]
    for ax, (block_id, score) in zip(axes, results):
        try:
            ax.imshow(Image.open(image_dir / f"{block_id}.jpg").convert("RGB"))
        except Exception:
            pass
        ax.set_title(f"{block_id}: {score:.3f}", fontsize=9)
        ax.axis("off")
    for ax in axes[len(results):]:
        ax.axis("off")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(out_path, dpi=100)
    plt.close(fig)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks-csv", default=str(REPO_ROOT / "blocks.csv"))
    ap.add_argument("--connections-csv", default=str(REPO_ROOT / "connections.csv"))
    ap.add_argument("--image-dir", default="/mnt/scratch/linpaul1/micro-silk/images")
    ap.add_argument("--text", help="Magic Search: text -> item")
    ap.add_argument("--item", type=int, help="'you might also connect': item -> item")
    ap.add_argument("--channel", type=int, help="board-centroid recommend: channel -> item")
    ap.add_argument("-k", type=int, default=9)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument(
        "--space",
        choices=["base", "finetuned"],
        default="base",
        help="base = frozen CLIP; finetuned = base reprojected through cache/projection_head.pt",
    )
    ap.add_argument("--grid", action="store_true", help="save a result grid image to retrieve_demo/")
    args = ap.parse_args()

    if sum(bool(x) for x in [args.text, args.item, args.channel]) != 1:
        raise SystemExit("pass exactly one of --text, --item, --channel")

    device = get_device()
    print(f"device: {device}")
    image_dir = Path(args.image_dir)

    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)

    E, ids = embed_corpus(args.blocks_csv, image_dir, processor, model, device, args.rebuild)
    if args.space == "finetuned":
        E = apply_finetuned_head(E)
    id2idx = {block_id: i for i, block_id in enumerate(ids)}

    if args.text:
        results = text_search(args.text, E, ids, processor, model, device, args.k)
        title = f"[{args.space}] text: {args.text!r}"
        tag = f"text_{''.join(c if c.isalnum() else '_' for c in args.text.lower())[:40]}_{args.space}"
    elif args.item:
        results = item_search(args.item, E, ids, id2idx, args.k)
        title = f"[{args.space}] related to block {args.item}"
        tag = f"item_{args.item}_{args.space}"
    else:
        channel_to_blocks = load_channel_to_blocks(args.connections_csv, id2idx)
        results = channel_search(args.channel, E, ids, id2idx, channel_to_blocks, args.k)
        title = f"[{args.space}] recommended for channel {args.channel}"
        tag = f"channel_{args.channel}_{args.space}"

    print(f"\n{title}:")
    for block_id, score in results:
        print(f"  {score:.3f}  block {block_id}")

    if args.grid:
        OUT_DIR.mkdir(exist_ok=True)
        save_result_grid(results, title, image_dir, OUT_DIR / f"{tag}.png")
        print(f"saved grid to {OUT_DIR / (tag + '.png')}")


if __name__ == "__main__":
    main()
