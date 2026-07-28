"""
Fast CLIP text->image search over large folders.

Key changes vs. the original script:
  1. Images are encoded in batches via a DataLoader (parallel decode/resize),
     not loaded all into RAM / one giant forward pass.
  2. Runs on GPU with fp16 if available.
  3. Image embeddings are cached to disk (embeddings.pt). Re-running with a
     new TEXT query reuses the cache instead of re-encoding 100k images.
  4. Similarity is a normalized dot product (equivalent to CLIP's cosine sim),
     computed once as a cheap matmul.
  5. Compatible with transformers 5.x, where CLIPModel.get_image_features()
     and get_text_features() return a BaseModelOutputWithPooling object
     instead of a raw tensor (they returned a plain tensor in 4.x).

Usage:
  python clip_search.py                # first run: encodes + caches + searches
  python clip_search.py                # later runs: loads cache, searches instantly
  python clip_search.py --rebuild      # force re-encode (e.g. folder changed)
"""

import argparse
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import CLIPProcessor, CLIPModel

IMAGE_FOLDER = Path("/mnt/scratch/linpaul1/micro-silk/images")
CACHE_PATH = Path("/mnt/scratch/linpaul1/micro-silk/embeddings.pt")
MODEL_NAME = "openai/clip-vit-base-patch32"
TEXT = "purple"
BATCH_SIZE = 256          # tune to your GPU memory; drop if you OOM
NUM_WORKERS = 8           # parallel CPU workers for image decode/resize
TOP_K = 20


def extract_features(output):
    """transformers 5.x wraps get_image_features/get_text_features output in
    BaseModelOutputWithPooling; 4.x returned a raw tensor. Handle both."""
    if hasattr(output, "pooler_output"):
        return output.pooler_output
    return output


class ImageDataset(Dataset):
    """Loads + preprocesses images lazily, one at a time, in worker processes."""

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
            # Return a black placeholder so a single corrupt file doesn't kill the run
            img = Image.new("RGB", (224, 224))
        pixel_values = self.processor(images=img, return_tensors="pt")["pixel_values"][0]
        return pixel_values, str(path)


def collate(batch):
    pixel_values = torch.stack([b[0] for b in batch])
    paths = [b[1] for b in batch]
    return pixel_values, paths


def build_embeddings(device, dtype):
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device=device, dtype=dtype)
    model.eval()

    image_paths = sorted(
        p for p in IMAGE_FOLDER.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    print(f"Found {len(image_paths)} images")

    dataset = ImageDataset(image_paths, processor)
    loader = DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        num_workers=NUM_WORKERS,
        collate_fn=collate,
        pin_memory=(device.type == "cuda"),
    )

    all_embeds = []
    all_paths = []
    with torch.inference_mode():
        for i, (pixel_values, paths) in enumerate(loader):
            pixel_values = pixel_values.to(device=device, dtype=dtype, non_blocking=True)
            feats = model.get_image_features(pixel_values=pixel_values)
            feats = extract_features(feats)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            all_embeds.append(feats.to(dtype=torch.float32).cpu())
            all_paths.extend(paths)
            print(f"  encoded batch {i + 1}/{len(loader)} "
                  f"({len(all_paths)}/{len(image_paths)} images)")

    embeddings = torch.cat(all_embeds, dim=0)  # [N, D], L2-normalized, fp32
    torch.save({"embeddings": embeddings, "paths": all_paths, "model": MODEL_NAME}, CACHE_PATH)
    print(f"Saved embeddings to {CACHE_PATH}")
    return embeddings, all_paths, processor, model


def load_or_build(device, dtype, rebuild):
    if CACHE_PATH.exists() and not rebuild:
        print(f"Loading cached embeddings from {CACHE_PATH}")
        data = torch.load(CACHE_PATH)
        if data.get("model") != MODEL_NAME:
            print("Cache was built with a different model, rebuilding...")
            return build_embeddings(device, dtype)
        processor = CLIPProcessor.from_pretrained(MODEL_NAME)
        model = CLIPModel.from_pretrained(MODEL_NAME).to(device=device, dtype=dtype)
        model.eval()
        return data["embeddings"], data["paths"], processor, model
    return build_embeddings(device, dtype)


def search(text, embeddings, paths, processor, model, device, dtype):
    with torch.inference_mode():
        text_inputs = processor(text=[text], return_tensors="pt", padding=True).to(device)
        text_feats = model.get_text_features(**text_inputs)
        text_feats = extract_features(text_feats).to(dtype=torch.float32)
        text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)
        text_feats = text_feats.cpu()

    # Cosine similarity: normalized image embeds . normalized text embed
    scores = embeddings @ text_feats.T  # [N, 1]
    scores = scores.squeeze(1)

    top = torch.topk(scores, k=min(TOP_K, len(paths)))
    print(f"\nTop {len(top.indices)} results for: {text!r}")
    for score, idx in zip(top.values, top.indices):
        print(f"{score.item():.3f}  {paths[idx]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true", help="Force re-encode all images")
    parser.add_argument("--text", default=TEXT, help="Search query text")
    args = parser.parse_args()

    if torch.cuda.is_available():
        device = torch.device("cuda")
        dtype = torch.float16
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
        dtype = torch.float32  # fp16 is flaky on MPS
    else:
        device = torch.device("cpu")
        dtype = torch.float32
    print(f"Using device: {device}, dtype: {dtype}")

    embeddings, paths, processor, model = load_or_build(device, dtype, args.rebuild)
    search(args.text, embeddings, paths, processor, model, device, dtype)