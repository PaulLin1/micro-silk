-- The feed (app/routes/home.tsx) and text search filter every query to
-- `type = 'Image' AND image_url IS NOT NULL` — ~104k of 121k rows — then
-- md5-sort for the random order. With no matching index that means a full
-- seq scan of the blocks heap (~200MB, ~200ms cold) on every feed load,
-- including each infinite-scroll page.
--
-- A partial index covering (id, title) turns that into an index-only scan
-- over a few MB. Keep the predicate in sync with the queries and with
-- `blocks_feed_idx` in app/db/schema.ts.
--
-- Apply manually (like 0001): CONCURRENTLY can't run inside a migration
-- transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "blocks_feed_idx"
    ON "blocks" USING btree ("id", "title")
    WHERE "type" = 'Image' AND "image_url" IS NOT NULL;
