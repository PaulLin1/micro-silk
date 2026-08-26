import { createArena } from "@aredotna/sdk";
import { createClient, getBlockConnections } from "@aredotna/sdk/api";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "node:fs";
import "dotenv/config";
import {
    blocks as blocksTable,
    channels as channelsTable,
    users as usersTable,
    connections as connectionsTable,
} from "~/lib/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

if (!process.env.ARENA_TOKEN) {
    console.error(
        "ARENA_TOKEN is not set — you'll be rate-limited at guest tier (30 req/min). Set it in .env.",
    );
    process.exit(1);
}

const arena = createArena({
    token: process.env.ARENA_TOKEN,
    retry: { respectRateLimits: true, maxRetries: 1 },
});
const rawClient = createClient({ token: process.env.ARENA_TOKEN });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 500; // free tier: 120/min ≈ 500ms/req; tighten if you confirm premium tier

// blocks whose connections lookup failed permanently — no DB table for this,
// so track in memory and flush to disk at the end for a manual re-run pass
const failedLookups: { arenaBlockId: number; reason: any }[] = [];

async function verifyToken() {
    const res = await fetch("https://api.are.na/v3/me", {
        headers: { Authorization: `Bearer ${process.env.ARENA_TOKEN}` },
    });
    if (!res.ok) {
        console.error(
            `Token check failed (${res.status}) — confirm ARENA_TOKEN is valid.`,
        );
        process.exit(1);
    }
    const me = await res.json();
    console.log(
        `Authenticated as ${me.username ?? me.slug} (tier: ${me.tier})`,
    );
}

// ---- rate-limit-aware wrapper for raw generated API calls ----
async function withRateLimitRetry<T>(
    fn: () => Promise<{ data?: T; error?: any }>,
    maxRetries = 3,
): Promise<T | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await fn();

        if (result.error?.type === "rate_limit_exceeded") {
            const waitMs = (result.error.retry_after ?? 60) * 1000 + 1000;
            console.warn(
                `rate limited (tier: ${result.error.tier}), waiting ${waitMs / 1000}s — attempt ${attempt + 1}/${maxRetries + 1}`,
            );
            await sleep(waitMs);
            continue;
        }

        if (result.error) {
            console.error("non-rate-limit error:", result.error);
            return null;
        }

        return result.data as T;
    }
    console.error("exceeded max retries on rate limit — giving up for now");
    return null;
}

// ---- upserts ----
async function upsertUser(user: any) {
    if (!user || user.type === "Group") return null;
    const [row] = await db
        .insert(usersTable)
        .values({ arenaUserId: user.id, username: user.slug, data: user })
        .onConflictDoUpdate({
            target: usersTable.arenaUserId,
            set: { username: user.slug, data: user },
        })
        .returning();
    return row;
}

async function upsertChannel(channelData: any) {
    const userRow = await upsertUser(channelData.owner);
    const [row] = await db
        .insert(channelsTable)
        .values({
            arenaChannelId: channelData.id,
            slug: channelData.slug,
            title: channelData.title,
            description: channelData.description?.plain ?? null,
            itemCount: channelData.counts?.blocks ?? 0,
            userId: userRow?.id ?? null,
            data: channelData,
        })
        .onConflictDoUpdate({
            target: channelsTable.arenaChannelId,
            set: {
                title: channelData.title,
                itemCount: channelData.counts?.blocks ?? 0,
                data: channelData,
            },
        })
        .returning();
    return row;
}

async function upsertBlock(block: any) {
    const [row] = await db
        .insert(blocksTable)
        .values({
            arenaBlockId: block.id,
            type: block.type,
            title: block.title ?? null,
            sourceUrl: block.source?.url ?? null,
            imageUrl: block.image?.original?.url ?? null,
        })
        .onConflictDoUpdate({
            target: blocksTable.arenaBlockId,
            set: {
                type: block.type,
                title: block.title ?? null,
                sourceUrl: block.source?.url ?? null,
                imageUrl: block.image?.original?.url ?? null,
            },
        })
        .returning();
    return row;
}

// ---- ingest one channel's contents ----
async function ingestChannel(slugOrId: string | number) {
    await sleep(THROTTLE_MS);
    const channelData = await arena.channels.get(String(slugOrId));
    const channelRow = await upsertChannel(channelData);

    const blockRows: { id: number; arenaBlockId: number }[] = [];
    const pages = arena.channels.paginateContents(channelData.slug, {
        per: 100,
    });

    for (let page = await pages.next(); !page.done; page = await pages.next()) {
        await sleep(THROTTLE_MS);
        for (const item of page.value.data as any[]) {
            if (item.base_type !== "Block") continue; // nested Channel entries — skip here, handle separately if you want them
            const blockRow = await upsertBlock(item);
            blockRows.push(blockRow);
            await db
                .insert(connectionsTable)
                .values({
                    blockId: blockRow.id,
                    channelId: channelRow.id,
                    data: { connection: item.connection },
                })
                .onConflictDoNothing();
        }
    }
    return { channelRow, blockRows };
}

// ---- snowball: channels a given block also appears in ----
async function findConnectedChannels(arenaBlockId: number) {
    await sleep(THROTTLE_MS);
    const result = await withRateLimitRetry(() =>
        getBlockConnections({
            client: rawClient,
            path: { id: arenaBlockId },
            query: { per: 50 },
        }),
    );
    if (result === null) {
        failedLookups.push({
            arenaBlockId,
            reason: { at: new Date().toISOString() },
        });
        return [];
    }
    return (result as any).data ?? [];
}

// ---- main ----
const seedSlugs = [
    "drain-gang-collection-archive-qcycxiz0byu",
    "drain-related",
    "drained",
    "aes-brutalist",
    "brutalist-art-architecture",
    "brutalist-_tvzitpjad0",
    "y2k-wfnhqmpy_n8",
    "y2k-km_zjbhp4fy",
    "grunge-corp-grunge",
    "soft-grunge-tumblr",
    "corporate-grunge-4bye2hjlezi",
];

async function main() {
    await verifyToken();

    const seen = new Set<number>();
    const queue: string[] = [...seedSlugs];
    const MAX_CHANNELS = 500; // trimmed from 2000 — see note on Are.na's acceptable-use terms

    while (queue.length && seen.size < MAX_CHANNELS) {
        const slug = queue.shift()!;
        try {
            const { channelRow, blockRows } = await ingestChannel(slug);
            if (seen.has(channelRow.arenaChannelId)) continue;
            seen.add(channelRow.arenaChannelId);
            console.log(
                `ingested ${slug} (${seen.size}/${MAX_CHANNELS} channels, ${blockRows.length} blocks)`,
            );

            const sample = blockRows.slice(0, 20); // cap snowball fan-out per channel
            for (const b of sample) {
                const connected = await findConnectedChannels(b.arenaBlockId);
                for (const c of connected as any[]) {
                    if (seen.has(c.id)) continue;
                    const size = c.counts?.blocks ?? 0;
                    if (size < 20 || size > 2000) continue;
                    queue.push(c.slug);
                }
            }
        } catch (err) {
            console.error(`failed on ${slug}:`, err);
            continue; // safe to retry later — everything above is upsert-based
        }
    }

    console.log(`done. ${seen.size} channels ingested.`);
    if (failedLookups.length) {
        fs.writeFileSync(
            "./failed-lookups.json",
            JSON.stringify(failedLookups, null, 2),
        );
        console.log(
            `${failedLookups.length} failed lookups written to failed-lookups.json — re-run these separately later.`,
        );
    }
    await pool.end();
}

main();
