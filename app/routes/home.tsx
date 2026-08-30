import { sql } from "drizzle-orm";
import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";
import { db } from "~/db.server";
import { blocks } from "~/db/schema";
import { posterNameSql } from "~/db/poster";

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
            imageUrl: blocks.imageUrl,
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