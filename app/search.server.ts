import { sql } from "drizzle-orm";
import { db } from "~/db.server";
import { blocks, blockEmbeddings, connections } from "~/db/schema";
import { embedText, toVectorLiteral } from "~/clip.server";

// must match ml/load_embeddings_to_postgres.py's DEFAULT_SPACE_VERSION — a
// different string here would silently compare against zero rows, not an error
export const MAGIC_SEARCH_SPACE_VERSION = "clip-vit-base-patch32_base";

// blocks has no per-block "posted by" column — a block's poster is whoever
// connected it to a channel, which only exists in connections.data. Take the
// earliest connection per block as the original poster.
//
// NOTE: reference the outer table as bare `blocks.id`, not `${blocks.id}` —
// interpolating a PgColumn inside a subquery's sql fragment renders as an
// unqualified `"id"`, which resolves to the subquery's own `connections.id`
// instead of correlating to the outer row, silently turning this into an
// uncorrelated (constant) subquery.
const posterNameSql = sql<string | null>`(
    SELECT c.data->'connection'->'connected_by'->>'name'
    FROM ${connections} AS c
    WHERE c.block_id = blocks.id
    ORDER BY (c.data->'connection'->>'connected_at')::timestamptz ASC NULLS LAST, c.id ASC
    LIMIT 1
)`;

export type ResultRow = { id: number; title: string | null; posterName: string | null };

// Semantic ("Magic Search"): embed the query text with the same frozen CLIP
// model used to embed every block image (ml/load_embeddings_to_postgres.py),
// then rank by cosine distance via pgvector. Returns null if there's nothing to search
// against yet (embeddings not backfilled in this environment) or the text
// encoder failed to load, so the caller can fall back to plain-text search.
export async function magicSearch(query: string): Promise<ResultRow[]> {
// export async function magicSearch(query: string): Promise<ResultRow[] | null> {

    // const hasEmbeddings = await db.execute<{ exists: boolean }>(
    //     sql`SELECT EXISTS (
    //         SELECT 1 FROM ${blockEmbeddings}
    //         WHERE ${blockEmbeddings.spaceVersion} = ${MAGIC_SEARCH_SPACE_VERSION}
    //     ) AS "exists"`,
    // );
    // if (!hasEmbeddings.rows[0]?.exists) return null;

    let embedding: number[];
    embedding = await embedText(query);

    // try {
    //     embedding = await embedText(query);
    // } catch (err) {
    //     console.error("magic search: failed to embed query text:", err);
    //     return null;
    // }


    const result = await db.execute<ResultRow>(sql`
        SELECT blocks.id, blocks.title, ${posterNameSql} AS "posterName"
        FROM ${blockEmbeddings} AS be
        JOIN blocks ON blocks.id = be.block_id
        WHERE be.space_version = ${MAGIC_SEARCH_SPACE_VERSION}
        ORDER BY be.embedding <=> ${toVectorLiteral(embedding)}::vector
        LIMIT 100
    `);
    return result.rows;
}

export async function textSearch(query: string): Promise<ResultRow[]> {
    const pattern = `%${query}%`;
    return db
        .select({
            id: blocks.id,
            title: blocks.title,
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
