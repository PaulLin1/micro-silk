-- block_embeddings now holds two space_versions (clip-vit-base-patch32_base
-- and clip-vit-base-patch32_channels-ft). A single HNSW index can't push a
-- WHERE space_version filter into the graph search, so ORDER BY embedding
-- <=> ... LIMIT k can return rows from the wrong space's ANN candidates only
-- and filter every one of them out, even at hnsw.ef_search = 1000 — this is
-- what broke magic search returning zero results for many queries. Scope the
-- index to the one space search.tsx actually reads.
DROP INDEX CONCURRENTLY "block_embeddings_hnsw_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY "block_embeddings_hnsw_idx" ON "block_embeddings" USING hnsw ("embedding" vector_cosine_ops) WHERE "space_version" = 'clip-vit-base-patch32_base';
