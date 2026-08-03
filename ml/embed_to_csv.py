"""
embed_to_csv.py — end to end: frozen CLIP image embedding for every block,
written to a CSV. No DB access here — matches ml/README.md's "the training
box never needs database access" setup. Load the CSV into Postgres separately,
wherever DATABASE_URL is reachable, with load_embeddings_to_postgres.py.

Reuses retrieve.py's embed_corpus() so the on-disk cache
(ml/cache/base_embeddings.pt) is shared: run retrieve.py first and this is an
instant load, not a re-embed.

Usage:
  cd ml && uv run python embed_to_csv.py
  uv run python embed_to_csv.py --image-dir /mnt/scratch/linpaul1/micro-silk/images
  uv run python embed_to_csv.py --rebuild --out artifacts/base/embeddings.csv
"""
import argparse
import csv
import os
from pathlib import Path

from transformers import CLIPModel, CLIPProcessor

from retrieve import MODEL_NAME, embed_corpus, get_device

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_ROOT = Path(__file__).resolve().parent

# frozen CLIP, no fine-tuning — bump this if MODEL_NAME ever changes, so old
# and new vectors never get compared as if they were the same space
DEFAULT_SPACE_VERSION = "clip-vit-base-patch32_base"


def format_vector(vec) -> str:
    # space-separated, not comma-separated — keeps this a plain 3-column CSV
    # with no embedded delimiters that need quoting. load_embeddings_to_postgres.py
    # rejoins the numbers with commas to build pgvector's '[v1,v2,...]' literal.
    return " ".join(f"{x:.7f}" for x in vec.tolist())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks-csv", default=str(REPO_ROOT / "blocks.csv"))
    ap.add_argument(
        "--image-dir",
        default=os.environ.get(
            "SILK_IMAGE_DIR", "/mnt/scratch/linpaul1/micro-silk/images"
        ),
    )
    ap.add_argument("--space-version", default=DEFAULT_SPACE_VERSION)
    ap.add_argument(
        "--out",
        default=None,
        help="defaults to ml/artifacts/<space-version>/embeddings.csv (artifacts/ is gitignored — large and fully reproducible)",
    )
    ap.add_argument(
        "--rebuild", action="store_true", help="recompute embeddings instead of using the cache"
    )
    args = ap.parse_args()

    out_path = Path(args.out) if args.out else ML_ROOT / "artifacts" / args.space_version / "embeddings.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    device = get_device()
    print(f"device: {device}")

    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)

    embeddings, ids = embed_corpus(
        args.blocks_csv, Path(args.image_dir), processor, model, device, args.rebuild
    )
    print(f"embedded {len(ids)} blocks — writing to {out_path}")

    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["block_id", "space_version", "embedding"])
        for block_id, vec in zip(ids, embeddings):
            writer.writerow([block_id, args.space_version, format_vector(vec)])

    print("done.")


if __name__ == "__main__":
    main()
