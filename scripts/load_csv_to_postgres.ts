// Bulk-loads the repo-root CSV exports into Postgres.
//
// Why this exists: `blocks` and `channels` live in Postgres with only the
// columns ingest_arena.ts extracts at crawl time (id, arena id, title, etc) —
// the full `data` jsonb blob was dropped from both tables to save space, and
// blocks never had an `image_url` column at all. `connections.csv` is a
// complete 1:1 mirror of the `connections` table already (skipped by default,
// see --include-connections). This script backfills what's missing:
//
//   blocks.csv    (id, image_url)                       -> blocks.image_url
//   channels.csv  (id, data, arena_channel_id, ...)      -> channels.data (+ re-affirm the rest)
//   connections.csv (opt-in safety net, onConflictDoNothing)
//
// Usage:
//   tsx scripts/load_csv_to_postgres.ts
//   tsx scripts/load_csv_to_postgres.ts --include-connections
import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import "dotenv/config";
import { blocks, channels, connections, users } from "~/lib/schema";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const INCLUDE_CONNECTIONS = process.argv.includes("--include-connections");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function readCsv<T>(filename: string): Promise<T[]> {
    const content = await fs.readFile(`${REPO_ROOT}${filename}`, "utf-8");
    return parse(content, { columns: true, skip_empty_lines: true }) as T[];
}

// ---- blocks.csv: id, image_url -> backfill blocks.image_url in one bulk UPDATE ----
async function loadBlocks() {
    type Row = { id: string; image_url: string };
    const rows = await readCsv<Row>("blocks.csv");
    console.log(`blocks.csv: ${rows.length} rows`);

    const ids = rows.map((r) => Number(r.id));
    const urls = rows.map((r) => (r.image_url?.length ? r.image_url : null));

    const result = await pool.query(
        `UPDATE blocks AS b
         SET image_url = v.image_url
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS image_url) AS v
         WHERE b.id = v.id`,
        [ids, urls],
    );
    console.log(`blocks: updated ${result.rowCount} rows with image_url`);
}

// ---- channels.csv: full dump (incl. data jsonb) -> upsert everything by arena_channel_id ----
async function loadChannels() {
    type Row = {
        id: string;
        data: string;
        crawled_at: string;
        arena_channel_id: string;
        slug: string;
        title: string;
        description: string;
        item_count: string;
        user_id: string;
    };
    const rows = await readCsv<Row>("channels.csv");
    console.log(`channels.csv: ${rows.length} rows`);

    let updated = 0;
    let userFallbacks = 0;

    for (const row of rows) {
        const data = JSON.parse(row.data);
        const arenaChannelId = Number(row.arena_channel_id);
        let userId: number | null = row.user_id ? Number(row.user_id) : null;

        if (userId !== null) {
            const [existing] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            if (!existing) userId = null; // resolved below from data.owner if possible
        }

        if (userId === null && data.owner && data.owner.type !== "Group") {
            userFallbacks++;
            const [userRow] = await db
                .insert(users)
                .values({
                    arenaUserId: data.owner.id,
                    username: data.owner.slug,
                    data: data.owner,
                })
                .onConflictDoUpdate({
                    target: users.arenaUserId,
                    set: { username: data.owner.slug, data: data.owner },
                })
                .returning();
            userId = userRow?.id ?? null;
        }

        await db
            .insert(channels)
            .values({
                arenaChannelId,
                slug: row.slug || null,
                title: row.title || null,
                description: row.description || null,
                itemCount: row.item_count ? Number(row.item_count) : null,
                userId,
                data,
            })
            .onConflictDoUpdate({
                target: channels.arenaChannelId,
                set: {
                    slug: row.slug || null,
                    title: row.title || null,
                    description: row.description || null,
                    itemCount: row.item_count ? Number(row.item_count) : null,
                    userId,
                    data,
                },
            });
        updated++;
    }
    console.log(
        `channels: upserted ${updated} rows (${userFallbacks} resolved owner via data.owner fallback)`,
    );

    const [{ nullCount }] = (await pool
        .query("SELECT count(*)::int AS \"nullCount\" FROM channels WHERE data IS NULL")
        .then((r) => r.rows)) as { nullCount: number }[];
    if (nullCount === 0) {
        await pool.query("ALTER TABLE channels ALTER COLUMN data SET NOT NULL");
        console.log("channels.data: fully backfilled, column set NOT NULL");
    } else {
        console.warn(
            `channels.data: ${nullCount} rows still NULL — leaving column nullable`,
        );
    }
}

// ---- connections.csv: already mirrors the live table 1:1 — opt-in safety net only ----
async function loadConnections() {
    type Row = {
        id: string;
        data: string;
        crawled_at: string;
        block_id: string;
        channel_id: string;
    };
    const rows = await readCsv<Row>("connections.csv");
    console.log(`connections.csv: ${rows.length} rows (--include-connections passed)`);

    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const result = await db
            .insert(connections)
            .values(
                chunk.map((r) => ({
                    blockId: Number(r.block_id),
                    channelId: Number(r.channel_id),
                    data: JSON.parse(r.data),
                })),
            )
            .onConflictDoNothing()
            .returning({ id: connections.id });
        inserted += result.length;
    }
    console.log(`connections: inserted ${inserted} new rows (rest already present)`);
}

async function main() {
    await loadBlocks();
    await loadChannels();

    if (INCLUDE_CONNECTIONS) {
        await loadConnections();
    } else {
        console.log(
            "connections.csv: skipped (already matches the live table 1:1) — pass --include-connections to force a safety-net upsert",
        );
    }

    await pool.end();
    console.log("done.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
