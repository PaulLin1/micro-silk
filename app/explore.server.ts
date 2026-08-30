import { sql } from "drizzle-orm";
import { db } from "~/db.server";
import { blocks, blockEmbeddings } from "~/db/schema";

// The one embedding space that actually has rows — keep in sync with
// MAGIC_SEARCH_SPACE_VERSION (app/search.server.ts) and the partial HNSW index
// predicate in app/db/schema.ts.
const SPACE_VERSION = "clip-vit-base-patch32_channels-ft-v5";

export type WebNode = {
    id: number;
    title: string | null;
    imageUrl: string | null;
    /** cosine distance from the queried image, 0…2 */
    dist: number;
};

export type Neighbourhood = { origin: WebNode; neighbours: WebNode[] };

// Neighbourhoods never change (embeddings are frozen), so cache per (id, limit).
// The explore web fans out one of these per node it expands — dozens per
// session, mostly repeats — so this keeps the whole thing off the database.
const CACHE_MAX = 4000;
const cache = new Map<string, Neighbourhood>();

function cacheGet(key: string): Neighbourhood | undefined {
    const hit = cache.get(key);
    if (hit) {
        cache.delete(key);
        cache.set(key, hit);
    }
    return hit;
}

function cacheSet(key: string, value: Neighbourhood): void {
    cache.set(key, value);
    if (cache.size > CACHE_MAX) {
        cache.delete(cache.keys().next().value as string);
    }
}

/**
 * The `limit` nearest image neighbours of `blockId` (plus the block itself as
 * `origin`). Returns null if the block has no embedding.
 */
export async function exploreNeighbours(
    blockId: number,
    limit: number,
): Promise<Neighbourhood | null> {
    // Fan-outs are small (≤ ~10), well under pgvector's default hnsw.ef_search
    // of 40, so this needs no SET-in-a-transaction — one round trip.
    limit = Math.max(1, Math.min(20, limit | 0));
    const key = `${blockId}:${limit}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const want = limit + 1; // +1 for the block itself (dist ~0)

    const rows = (
        await db.execute<{
            block_id: number;
            title: string | null;
            image_url: string | null;
            dist: number;
        }>(sql`
            WITH q AS (
                SELECT embedding AS e
                FROM ${blockEmbeddings}
                WHERE block_id = ${blockId} AND space_version = ${SPACE_VERSION}
            )
            SELECT be.block_id, b.title, b.image_url,
                   (be.embedding <=> (SELECT e FROM q)) AS dist
            FROM ${blockEmbeddings} be
            JOIN ${blocks} b ON b.id = be.block_id
            WHERE be.space_version = ${SPACE_VERSION}
              AND b.type = 'Image'
              AND b.image_url IS NOT NULL
              AND (SELECT e FROM q) IS NOT NULL
            ORDER BY be.embedding <=> (SELECT e FROM q)
            LIMIT ${want}
        `)
    ).rows;

    if (rows.length === 0) return null;

    const toNode = (r: (typeof rows)[number]): WebNode => ({
        id: Number(r.block_id),
        title: r.title,
        imageUrl: r.image_url,
        dist: Number(r.dist),
    });

    // Row 0 is the block itself (nearest to itself). If for some reason it isn't
    // in the result, synthesise a bare origin so the client still has one.
    let originRow = rows.findIndex((r) => Number(r.block_id) === blockId);
    if (originRow < 0) originRow = 0;

    const value: Neighbourhood = {
        origin: toNode(rows[originRow]),
        neighbours: rows
            .filter((_, i) => i !== originRow)
            .slice(0, limit)
            .map(toNode),
    };
    cacheSet(key, value);
    return value;
}
