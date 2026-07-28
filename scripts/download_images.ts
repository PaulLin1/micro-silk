import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import fs from "node:fs/promises";
import "dotenv/config";

import { blocks as blocksTable } from "~/db/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const db = drizzle(pool);

const folder_dir = "/mnt/scratch/linpaul1/micro-silk/images";
await fs.mkdir(folder_dir, { recursive: true });

const PAGE_SIZE = 5000;
const CONCURRENCY = 50;

let lastId: number | null = null;
let totalDownloaded = 0;
let totalSkipped = 0;
let totalFailed = 0;

async function downloadImage(row: { id: number; src: string | null }) {
  if (!row.src) {
    totalSkipped++;
    return;
  }

  try {
    const response = await fetch(row.src);

    if (!response.ok) {
      console.log(`Failed ${row.id}: ${response.status}`);
      totalFailed++;
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(`${folder_dir}/${row.id}.jpg`, buffer);
    totalDownloaded++;
  } catch (error) {
    console.error(`Error ${row.id}:`, error);
    totalFailed++;
  }
}

async function processBatchConcurrently(
  rows: { id: number; src: string | null }[],
  concurrency: number,
) {
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    await Promise.all(chunk.map(downloadImage));
  }
}

console.time("total");

while (true) {
  console.time("page-select");

  // Only pull id + the one JSON field we need — avoids hauling
  // full JSONB blobs (and any other large columns) over the wire.
  const page = await db
    .select({
      id: blocksTable.id,
      src: sql<string | null>`${blocksTable.data}->'image'->'small'->>'src'`,
    })
    .from(blocksTable)
    .where(lastId !== null ? sql`${blocksTable.id} > ${lastId}` : sql`true`)
    .orderBy(blocksTable.id)
    .limit(PAGE_SIZE);

  console.timeEnd("page-select");

  if (page.length === 0) break;

  await processBatchConcurrently(page, CONCURRENCY);

  lastId = page[page.length - 1].id;

  console.log(
    `progress: downloaded=${totalDownloaded} skipped=${totalSkipped} failed=${totalFailed} lastId=${lastId}`,
  );
}

console.timeEnd("total");
console.log(
  `done. downloaded=${totalDownloaded} skipped=${totalSkipped} failed=${totalFailed}`,
);

await pool.end();