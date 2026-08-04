"""
load_embeddings_to_postgres.py — reads a CSV produced by embed_to_csv.py
(block_id, space_version, embedding) and upserts it into the `block_embeddings`
pgvector table (see app/db/schema.ts). Split out from the embedding step so the
GPU box that runs embed_to_csv.py never needs DATABASE_URL — only wherever
this script runs does (matches ml/README.md's data.export_graph split, just
in the other direction: CSV -> Postgres instead of Postgres -> CSV).

Usage:
  cd ml && uv run python load_embeddings_to_postgres.py
  uv run python load_embeddings_to_postgres.py --csv artifacts/clip-vit-base-patch32_base/embeddings.csv
"""
import argparse
import csv
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_ROOT = Path(__file__).resolve().parent
load_dotenv(REPO_ROOT / ".env")

DEFAULT_SPACE_VERSION = "clip-vit-base-patch32_channels-ft-v5"


def to_vector_literal(space_separated_embedding: str) -> str:
    # embed_to_csv.py writes the embedding as space-separated floats (a plain
    # CSV column, no quoting needed); pgvector's text input format wants
    # comma-separated inside brackets.
    return "[" + ",".join(space_separated_embedding.split()) + "]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--csv",
        default=str(ML_ROOT / "embeddings.csv"),
    )
    ap.add_argument("--batch-size", type=int, default=1000)
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL not set (checked --database-url and repo-root .env)")

    with open(args.csv, newline="") as f:
        rows = list(csv.DictReader(f))
    print(f"{args.csv}: {len(rows)} rows")

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            done = 0
            for i in range(0, len(rows), args.batch_size):
                batch = rows[i : i + args.batch_size]
                values = [
                    (
                        int(row["block_id"]),
                        row["space_version"],
                        to_vector_literal(row["embedding"]),
                    )
                    for row in batch
                ]
                cur.executemany(
                    """
                    INSERT INTO block_embeddings (block_id, space_version, embedding)
                    VALUES (%s, %s, %s::vector)
                    ON CONFLICT (block_id, space_version)
                    DO UPDATE SET embedding = EXCLUDED.embedding
                    """,
                    values,
                )
                done += len(values)
                print(f"  upserted {done}/{len(rows)}")
        conn.commit()

    print("done.")


if __name__ == "__main__":
    main()
