import { sql } from "drizzle-orm";
import type { Route } from "./+types/ambient";
import { db } from "~/db.server";
import { blocks } from "~/db/schema";

// Resource route: no component. components/AmbientCollage.tsx fetches this once
// when the ambient preview mode opens, and pools over the returned images.
export async function loader({ request }: Route.LoaderArgs) {
    const seed = new URL(request.url).searchParams.get("seed") ?? String(Date.now());

    const rows = await db
        .select({ id: blocks.id, imageUrl: blocks.imageUrl })
        .from(blocks)
        .where(sql`${blocks.type} = 'Image' AND ${blocks.imageUrl} IS NOT NULL`)
        .orderBy(sql`md5(${blocks.id}::text || ${seed})`)
        .limit(48);

    return { blocks: rows };
}
