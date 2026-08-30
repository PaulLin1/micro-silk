/**
 * One-off: apply the performance indexes in drizzle/0002 and drizzle/0003.
 *
 *   npx tsx scripts/apply_indexes.ts
 *
 * Safe to re-run. Uses CREATE INDEX CONCURRENTLY so it won't lock the tables;
 * the HNSW build on ~120k vectors takes a few minutes. drizzle-kit can't do
 * this (CONCURRENTLY can't run inside its migration transaction).
 */
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const steps: [string, string][] = [
    [
        "feed index (0002)",
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS blocks_feed_idx
           ON blocks USING btree (id, title)
           WHERE type = 'Image' AND image_url IS NOT NULL`,
    ],
    [
        "drop stale HNSW index (0003)",
        `DROP INDEX CONCURRENTLY IF EXISTS block_embeddings_hnsw_idx`,
    ],
    [
        "rebuild HNSW index on the live space_version (0003) — a few minutes",
        `CREATE INDEX CONCURRENTLY block_embeddings_hnsw_idx
           ON block_embeddings USING hnsw (embedding vector_cosine_ops)
           WHERE space_version = 'clip-vit-base-patch32_channels-ft-v5'`,
    ],
];

for (const [label, sql] of steps) {
    process.stdout.write(`• ${label} … `);
    const t = Date.now();
    try {
        await pool.query(sql);
        console.log(`done (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    } catch (err) {
        console.log("FAILED");
        console.error(err);
        process.exit(1);
    }
}

await pool.end();
console.log("\nAll indexes in place. Magic search and the similarity map are now fast.");
