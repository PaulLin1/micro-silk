import { sql } from "drizzle-orm";
import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";
import { db } from "~/db.server";
import { blocks, connections } from "~/db/schema";

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

export function meta({}: Route.MetaArgs) {
    return [
        { title: "Micro Silk" },
        { name: "description", content: "Recreation of Silk" },
    ];
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    // Reuse the same seed across paginated calls for this session so the
    // "random" order stays stable — a new seed each request would let
    // random() reshuffle underneath you again, causing dupes/skips.
    const seed = url.searchParams.get("seed") ?? String(Date.now());

    const rows = await db
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

    return { blocks: rows, seed };
}

export default function Home({ loaderData }: Route.ComponentProps) {
    return <Welcome initialBlocks={loaderData.blocks} initialSeed={loaderData.seed} />;
}