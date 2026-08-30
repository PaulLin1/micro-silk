-- The partial HNSW index was scoped to space_version
-- 'clip-vit-base-patch32_base', but every row in block_embeddings is
-- 'clip-vit-base-patch32_channels-ft-v5' (see ml/load_embeddings_to_postgres.py
-- and app/search.server.ts). So the index covered zero rows and pgvector
-- silently fell back to a full brute-force scan on every magic search and every
-- /explore/:id load (~660ms over ~120k × 512-dim vectors).
--
-- Rebuild it against the space that actually exists. Keep the predicate in sync
-- with LIVE_SPACE_VERSION in app/db/schema.ts.
--
-- Apply manually (like 0001 / 0002): CONCURRENTLY can't run in a migration
-- transaction, and the build wants room — bump maintenance_work_mem for the
-- session first if the platform allows it, e.g.:
--   SET maintenance_work_mem = '512MB';
DROP INDEX CONCURRENTLY IF EXISTS "block_embeddings_hnsw_idx";

CREATE INDEX CONCURRENTLY "block_embeddings_hnsw_idx"
    ON "block_embeddings" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "space_version" = 'clip-vit-base-patch32_channels-ft-v5';
