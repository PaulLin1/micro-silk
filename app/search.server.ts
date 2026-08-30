import { sql } from "drizzle-orm";
import { db } from "~/db.server";
import { blocks, blockEmbeddings, connections } from "~/db/schema";
import { posterNameSql } from "~/db/poster";
import { embedText, toVectorLiteral } from "~/clip.server";

// must match ml/load_embeddings_to_postgres.py's DEFAULT_SPACE_VERSION — a
// different string here would silently compare against zero rows, not an error
export const MAGIC_SEARCH_SPACE_VERSION = "clip-vit-base-patch32_channels-ft-v5";

export type ResultRow = {
    id: number;
    title: string | null;
    imageUrl: string | null;
    posterName: string | null;
};

// Semantic ("Magic Search"): embed the query text with the same frozen CLIP
// model used to embed every block image, then rank by cosine distance via
// pgvector's HNSW index.
export async function magicSearch(query: string): Promise<ResultRow[]> {
    const embedding = await embedText(query);

    const result = await db.execute<ResultRow>(sql`
        SELECT blocks.id, blocks.title, blocks.image_url AS "imageUrl", ${posterNameSql} AS "posterName"
        FROM ${blockEmbeddings} AS be
        JOIN blocks ON blocks.id = be.block_id
        WHERE be.space_version = ${MAGIC_SEARCH_SPACE_VERSION}
        ORDER BY be.embedding <=> ${toVectorLiteral(embedding)}::vector
        LIMIT 100
    `);
    return result.rows;
}

// Plain substring match on title / connector name — the fallback when the CLIP
// text encoder can't be loaded.
export async function textSearch(query: string): Promise<ResultRow[]> {
    const pattern = `%${query}%`;
    return db
        .select({
            id: blocks.id,
            title: blocks.title,
            imageUrl: blocks.imageUrl,
            posterName: posterNameSql,
        })
        .from(blocks)
        .where(sql`
            ${blocks.type} = 'Image' AND ${blocks.imageUrl} IS NOT NULL
            AND (
                ${blocks.title} ILIKE ${pattern}
                OR EXISTS (
                    SELECT 1 FROM ${connections} AS c
                    WHERE c.block_id = blocks.id
                        AND c.data->'connection'->'connected_by'->>'name' ILIKE ${pattern}
                )
            )
        `)
        .limit(100);
}

// What the route calls: semantic search, degrading to substring search rather
// than 500-ing if the model is unavailable.
export async function search(query: string): Promise<ResultRow[]> {
    try {
        return await magicSearch(query);
    } catch (err) {
        console.error("magic search failed; falling back to text search:", err);
        return textSearch(query);
    }
}
