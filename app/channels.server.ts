import { sql } from "drizzle-orm";
import { db } from "~/db.server";
import type { Block } from "~/components/PostGrid";

// are.na channels are the curatorial unit — a titled collection of blocks put
// together by one person. The `channels` / `connections` tables are already
// populated; this surfaces them.

export type ChannelPreview = { id: number; imageUrl: string | null };

export type ChannelCard = {
    id: number;
    title: string;
    description: string | null;
    itemCount: number | null;
    curator: string | null;
    preview: ChannelPreview[];
};

export type ChannelDetail = {
    id: number;
    title: string;
    description: string | null;
    itemCount: number | null;
    curator: string | null;
    blocks: Block[];
};

// Channel data is static in this demo, so cache the (heavier) list query.
let listCache: ChannelCard[] | null = null;

export async function listChannels(): Promise<ChannelCard[]> {
    if (listCache) return listCache;

    const res = await db.execute<{
        id: number;
        title: string;
        description: string | null;
        item_count: number | null;
        curator: string | null;
        preview: ChannelPreview[] | null;
    }>(sql`
        SELECT ch.id,
               ch.title,
               ch.description,
               ch.item_count,
               u.username AS curator,
               prev.preview
        FROM channels ch
        LEFT JOIN users u ON u.id = ch.user_id
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                       jsonb_build_object('id', x.id, 'imageUrl', x.image_url)
                   ) AS preview
            FROM (
                SELECT b.id, b.image_url
                FROM connections c
                JOIN blocks b ON b.id = c.block_id
                WHERE c.channel_id = ch.id
                  AND b.type = 'Image'
                  AND b.image_url IS NOT NULL
                LIMIT 4
            ) x
        ) prev ON true
        WHERE ch.title IS NOT NULL
        ORDER BY ch.item_count DESC NULLS LAST
        LIMIT 90
    `);

    listCache = res.rows.map((r) => ({
        id: Number(r.id),
        title: r.title.trim() || "Untitled",
        description: r.description,
        itemCount: r.item_count == null ? null : Number(r.item_count),
        curator: r.curator,
        preview: r.preview ?? [],
    }));
    return listCache;
}

export async function getChannel(id: number): Promise<ChannelDetail | null> {
    const meta = await db.execute<{
        id: number;
        title: string | null;
        description: string | null;
        item_count: number | null;
        curator: string | null;
    }>(sql`
        SELECT ch.id, ch.title, ch.description, ch.item_count, u.username AS curator
        FROM channels ch
        LEFT JOIN users u ON u.id = ch.user_id
        WHERE ch.id = ${id}
        LIMIT 1
    `);
    const m = meta.rows[0];
    if (!m) return null;

    const blocksRes = await db.execute<{
        id: number;
        title: string | null;
        image_url: string | null;
        poster_name: string | null;
    }>(sql`
        SELECT b.id,
               b.title,
               b.image_url,
               (c.data->'connection'->'connected_by'->>'name') AS poster_name
        FROM connections c
        JOIN blocks b ON b.id = c.block_id
        WHERE c.channel_id = ${id}
          AND b.type = 'Image'
          AND b.image_url IS NOT NULL
        ORDER BY c.id DESC
        LIMIT 120
    `);

    return {
        id: Number(m.id),
        title: (m.title ?? "").trim() || "Untitled",
        description: m.description,
        itemCount: m.item_count == null ? null : Number(m.item_count),
        curator: m.curator,
        blocks: blocksRes.rows.map((b) => ({
            id: Number(b.id),
            title: b.title,
            imageUrl: b.image_url,
            posterName: b.poster_name,
        })),
    };
}
