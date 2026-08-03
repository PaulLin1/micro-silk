"""
embed_to_postgres.py — end to end: frozen CLIP image embedding for every block,
written straight into Postgres.

This is the "build now" retrieval layer from ARCHITECTURE.md's proposed path to
production, applied: no fine-tuning, no training, just one off-the-shelf CLIP
vector per block (openai/clip-vit-base-patch32) upserted into a dedicated
pgvector table (`block_embeddings`, see app/db/schema.ts) rather than a column
on `blocks` — that keeps re-embeds additive/versioned (tagged by
--space-version) instead of an in-place overwrite, matching the versioning
discipline in ml/README.md.

Reuses retrieve.py's embed_corpus() so the on-disk cache
(ml/cache/base_embeddings.pt) is shared: run retrieve.py first and this is an
instant load, not a re-embed.

Usage:
  cd ml && uv run python embed_to_postgres.py
  uv run python embed_to_postgres.py --image-dir /mnt/scratch/linpaul1/micro-silk/images
  uv run python embed_to_postgres.py --rebuild --batch-size 1000
"""
import argparse
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from transformers import CLIPModel, CLIPProcessor

from retrieve import MODEL_NAME, embed_corpus, get_device

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

# frozen CLIP, no fine-tuning — bump this if MODEL_NAME ever changes, so old
# and new vectors never get compared as if they were the same space
DEFAULT_SPACE_VERSION = "clip-vit-base-patch32_base"


def format_vector(vec) -> str:
    # pgvector accepts the literal text form '[v1,v2,...]' cast to ::vector —
    # avoids adding the `pgvector` python package just for this one direction
    return "[" + ",".join(f"{x:.7f}" for x in vec.tolist()) + "]"


def upsert_embeddings(database_url, ids, embeddings, space_version, batch_size):
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            done = 0
            for i in range(0, len(ids), batch_size):
                batch_ids = ids[i : i + batch_size]
                batch_vecs = embeddings[i : i + batch_size]
                rows = [
                    (block_id, space_version, format_vector(vec))
                    for block_id, vec in zip(batch_ids, batch_vecs)
                ]
                cur.executemany(
                    """
                    INSERT INTO block_embeddings (block_id, space_version, embedding)
                    VALUES (%s, %s, %s::vector)
                    ON CONFLICT (block_id, space_version)
                    DO UPDATE SET embedding = EXCLUDED.embedding
                    """,
                    rows,
                )
                done += len(rows)
                print(f"  upserted {done}/{len(ids)}")
        conn.commit()


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
    ap.add_argument("--batch-size", type=int, default=500)
    ap.add_argument(
        "--rebuild", action="store_true", help="recompute embeddings instead of using the cache"
    )
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL not set (checked --database-url and repo-root .env)")

    device = get_device()
    print(f"device: {device}")

    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)

    embeddings, ids = embed_corpus(
        args.blocks_csv, Path(args.image_dir), processor, model, device, args.rebuild
    )
    print(f"embedded {len(ids)} blocks — upserting into block_embeddings as space {args.space_version!r}")

    upsert_embeddings(args.database_url, ids, embeddings, args.space_version, args.batch_size)
    print("done.")


if __name__ == "__main__":
    main()
