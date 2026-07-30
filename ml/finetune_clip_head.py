"""
simple_clip_demo.py — bare-minimum CLIP demo. No training, no channels, no
holdout. Just: embed every image with off-the-shelf CLIP, run a few text
queries, save the top results as images. That's it.

Usage:
  python simple_clip_demo.py
  python simple_clip_demo.py --query "drain aesthetic"
  python simple_clip_demo.py --rebuild   # force re-encode images
"""
import argparse
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import CLIPProcessor, CLIPModel

try:
    import matplotlib.pyplot as plt
    HAS_PLOTTING = True
except ImportError:
    HAS_PLOTTING = False

IMAGE_DIR = Path("/mnt/scratch/linpaul1/micro-silk/images")
CACHE_PATH = Path("/mnt/scratch/linpaul1/micro-silk/embeddings.pt")
OUT_DIR = Path("./demo_results")
MODEL_NAME = "openai/clip-vit-base-patch32"

QUERIES = [
    "drain gang",
    "brutalist architecture",
    "y2k interface",
    "handwritten text on paper",
    "washed out photography",
]


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def extract_features(output):
    return output.pooler_output if hasattr(output, "pooler_output") else output


class ImageDataset(Dataset):
    def __init__(self, paths, processor):
        self.paths = paths
        self.processor = processor

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        path = self.paths[idx]
        try:
            img = Image.open(path).convert("RGB")
        except Exception:
            img = Image.new("RGB", (224, 224))
        return self.processor(images=img, return_tensors="pt")["pixel_values"][0], str(path)


def collate(batch):
    return torch.stack([b[0] for b in batch]), [b[1] for b in batch]


def embed_images(image_dir, processor, model, device):
    paths = sorted(
        p for p in image_dir.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    print(f"found {len(paths)} images, encoding...")
    loader = DataLoader(ImageDataset(paths, processor), batch_size=128, num_workers=4, collate_fn=collate)

    embeds, out_paths = [], []
    with torch.inference_mode():
        for i, (pixel_values, batch_paths) in enumerate(loader):
            feats = extract_features(model.get_image_features(pixel_values=pixel_values.to(device)))
            feats = F.normalize(feats.to(torch.float32), dim=-1).cpu()
            embeds.append(feats)
            out_paths.extend(batch_paths)
            print(f"  batch {i+1}/{len(loader)} ({len(out_paths)}/{len(paths)})")

    embeddings = torch.cat(embeds, dim=0)
    torch.save({"embeddings": embeddings, "paths": out_paths, "model": MODEL_NAME}, CACHE_PATH)
    return embeddings, out_paths


def load_or_embed(image_dir, processor, model, device, rebuild):
    if CACHE_PATH.exists() and not rebuild:
        data = torch.load(CACHE_PATH)
        if data.get("model") == MODEL_NAME:
            print(f"loaded cached embeddings: {len(data['paths'])} images")
            return data["embeddings"], data["paths"]
    return embed_images(image_dir, processor, model, device)


def search(query, embeddings, paths, processor, model, device, k=9):
    with torch.inference_mode():
        inputs = processor(text=[query], return_tensors="pt", padding=True).to(device)
        text_feat = extract_features(model.get_text_features(**inputs))
        text_feat = F.normalize(text_feat.to(torch.float32), dim=-1).cpu()
    scores = (embeddings @ text_feat.T).squeeze(1)
    top = scores.topk(min(k, len(paths)))
    return [(paths[i], top.values[j].item()) for j, i in enumerate(top.indices.tolist())]


def save_result_grid(results, query, out_path):
    if not HAS_PLOTTING:
        print(f"(matplotlib not installed — skipping image grid for {query!r})")
        return
    n = len(results)
    cols = 3
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(9, 3 * rows))
    axes = axes.flatten() if n > 1 else [axes]
    for ax, (path, score) in zip(axes, results):
        try:
            ax.imshow(Image.open(path).convert("RGB"))
        except Exception:
            pass
        ax.set_title(f"{score:.3f}", fontsize=9)
        ax.axis("off")
    for ax in axes[len(results):]:
        ax.axis("off")
    fig.suptitle(f"CLIP search: {query!r}")
    fig.tight_layout()
    fig.savefig(out_path, dpi=100)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image-dir", default=str(IMAGE_DIR))
    ap.add_argument("--query", action="append", help="add a query (repeatable); defaults to QUERIES list")
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    device = get_device()
    print(f"device: {device}")

    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()

    embeddings, paths = load_or_embed(Path(args.image_dir), processor, model, device, args.rebuild)

    OUT_DIR.mkdir(exist_ok=True)
    queries = args.query if args.query else QUERIES

    for q in queries:
        results = search(q, embeddings, paths, processor, model, device)
        print(f"\n{q!r}:")
        for path, score in results:
            print(f"  {score:.3f}  {path}")
        safe = "".join(c if c.isalnum() else "_" for c in q.lower())[:40]
        save_result_grid(results, q, OUT_DIR / f"{safe}.png")

    print(f"\ndone. results saved to {OUT_DIR}/")


if __name__ == "__main__":
    main()