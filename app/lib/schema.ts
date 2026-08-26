import { sql } from "drizzle-orm";
import {
    pgTable,
    integer,
    serial,
    jsonb,
    timestamp,
    text,
    uniqueIndex,
    index,
    vector,
} from "drizzle-orm/pg-core";

// keep in sync with MAGIC_SEARCH_SPACE_VERSION in app/lib/search.ts —
// the space actually served to users right now
const LIVE_SPACE_VERSION = "clip-vit-base-patch32_base";

export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    arenaUserId: integer("arena_user_id").unique().notNull(),
    username: text("username"),
    data: jsonb("data").notNull(),
    crawledAt: timestamp("crawled_at").defaultNow().notNull(),
});

export const channels = pgTable("channels", {
    id: serial("id").primaryKey(),
    arenaChannelId: integer("arena_channel_id").unique().notNull(),
    slug: text("slug"),
    title: text("title"),
    description: text("description"),
    itemCount: integer("item_count"), // needed for the [20, 2000] snowball size filter
    userId: integer("user_id").references(() => users.id),
    data: jsonb("data").notNull(),
    crawledAt: timestamp("crawled_at").defaultNow().notNull(),
});

export const blocks = pgTable("blocks", {
    id: serial("id").primaryKey(),
    arenaBlockId: integer("arena_block_id").unique().notNull(),
    type: text("type"), // Image / Text / Link / Media / Attachment — from block.class
    title: text("title"),
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"), // are.na CDN asset URL, from blocks.csv — poster info comes from connections, not a per-block column
    crawledAt: timestamp("crawled_at").defaultNow().notNull(),
});

// one row per (block, embedding space) — additive/versioned so a re-embed never
// requires an in-place overwrite; join to blocks for display
export const blockEmbeddings = pgTable(
    "block_embeddings",
    {
        id: serial("id").primaryKey(),
        blockId: integer("block_id")
            .notNull()
            .references(() => blocks.id),
        spaceVersion: text("space_version").notNull(),
        embedding: vector("embedding", { dimensions: 512 }).notNull(),
        crawledAt: timestamp("crawled_at").defaultNow().notNull(),
    },
    (t) => ({
        uniqBlockSpace: uniqueIndex("uniq_block_embeddings_block_space").on(
            t.blockId,
            t.spaceVersion,
        ),
        // partial, not global: an HNSW index can't push a WHERE space_version
        // filter down into the graph search, so with >1 space's vectors
        // living in one index, ORDER BY embedding <=> ... LIMIT k can walk
        // right past every row in the space actually being queried and
        // return zero results — no amount of ef_search/iterative_scan tuning
        // fixes that, since the *other* space's vectors can legitimately
        // dominate the global ranking for a given query. Scoping the index
        // to the one space search.tsx reads keeps ANN search correct; a
        // future space_version bump needs a new partial index (and this
        // constant updated), same as it already needs a full re-embed.
        hnswIdx: index("block_embeddings_hnsw_idx")
            .using("hnsw", t.embedding.op("vector_cosine_ops"))
            .where(sql`${t.spaceVersion} = ${LIVE_SPACE_VERSION}`),
    }),
);

// one row per (block, channel) co-occurrence — this table IS the training data
export const connections = pgTable(
    "connections",
    {
        id: serial("id").primaryKey(),
        blockId: integer("block_id")
            .notNull()
            .references(() => blocks.id),
        channelId: integer("channel_id")
            .notNull()
            .references(() => channels.id),
        data: jsonb("data").notNull(),
        crawledAt: timestamp("crawled_at").defaultNow().notNull(),
    },
    (t) => ({
        uniqBlockChannel: uniqueIndex("uniq_block_channel").on(
            t.blockId,
            t.channelId,
        ),
        channelIdx: index("connections_channel_idx").on(t.channelId),
        blockIdx: index("connections_block_idx").on(t.blockId),
    }),
);

// mirror table, same shape — populated once, before any training, then frozen
export const holdoutConnections = pgTable(
    "holdout_connections",
    {
        id: serial("id").primaryKey(),
        blockId: integer("block_id")
            .notNull()
            .references(() => blocks.id),
        channelId: integer("channel_id")
            .notNull()
            .references(() => channels.id),
        crawledAt: timestamp("crawled_at").defaultNow().notNull(),
    },
    (t) => ({
        uniqBlockChannel: uniqueIndex("uniq_holdout_block_channel").on(
            t.blockId,
            t.channelId,
        ),
    }),
);
