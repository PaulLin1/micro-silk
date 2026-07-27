import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "node:fs/promises";
import "dotenv/config";

import { blocks as blocksTable } from "~/db/schema";

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

const rows = await db.select().from(blocksTable);

await fs.mkdir("./images", { recursive: true });

const CONCURRENCY = 20;

async function downloadImage(row: typeof rows[number]) {
    const url = row.data?.image?.small?.src;

    if (!url) return;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.log(`Failed ${row.id}: ${response.status}`);
            return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        await fs.writeFile(`./images/${row.id}.jpg`, buffer);

        console.log(`Downloaded ${row.id}`);
    } catch (error) {
        console.error(`Error ${row.id}:`, error);
    }
}

for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);

    await Promise.all(
        batch.map(downloadImage)
    );
}

await pool.end();