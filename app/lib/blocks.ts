import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { blocks, connections } from "~/lib/schema";

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

export type FeedBlock = {
    id: number;
    title: string | null;
    posterName: string | null;
};

// One page of the randomized image feed. `seed` is held constant across a
// session's paginated calls so `md5(id || seed)` stays a stable total order —
// a fresh seed per request would let the ordering reshuffle underneath the
// reader, causing dupes/skips.
export async function getFeedBlocks({
    offset,
    seed,
}: {
    offset: number;
    seed: string;
}): Promise<FeedBlock[]> {
    return db
        .select({
            id: blocks.id,
            title: blocks.title,
            posterName: posterNameSql,
        })
        .from(blocks)
        .where(sql`${blocks.type} = 'Image' AND ${blocks.imageUrl} IS NOT NULL`)
        .orderBy(sql`md5(${blocks.id}::text || ${seed})`)
        .limit(100)
        .offset(offset);
}
