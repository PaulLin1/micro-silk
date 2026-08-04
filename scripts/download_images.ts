import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import "dotenv/config";

const csv_path = "./blocks.csv";
const folder_dir = "/mnt/scratch/linpaul1/micro-silk/images";

await fs.mkdir(folder_dir, { recursive: true });

const CONCURRENCY = 50;

let totalDownloaded = 0;
let totalSkipped = 0;
let totalAlreadyExists = 0;
let totalFailed = 0;

type Row = { id: number; src: string | null };

async function downloadImage(row: Row) {
  if (!row.src) {
    totalSkipped++;
    return;
  }

  const path = `${folder_dir}/${row.id}.jpg`;

  // re-running this script used to re-fetch all ~121k images from scratch
  // every time, which is exactly why partial runs (missing images, a dead
  // network mid-run, etc.) never got backfilled — nobody could afford to
  // rerun the whole thing. Skip whatever's already on disk instead.
  try {
    await fs.access(path);
    totalAlreadyExists++;
    return;
  } catch {
    // doesn't exist yet — fall through and fetch it
  }

  try {
    const response = await fetch(row.src);

    if (!response.ok) {
      console.log(`Failed ${row.id}: ${response.status}`);
      totalFailed++;
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path, buffer);
    totalDownloaded++;
  } catch (error) {
    console.error(`Error ${row.id}:`, error);
    totalFailed++;
  }
}

async function processBatchConcurrently(rows: Row[], concurrency: number) {
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    await Promise.all(chunk.map(downloadImage));
  }
}

console.time("total");

console.time("csv-read");
const fileContent = await fs.readFile(csv_path, "utf-8");
const records: { id: string; image_url: string }[] = parse(fileContent, {
  columns: true,
  skip_empty_lines: true,
});
console.timeEnd("csv-read");

const rows: Row[] = records.map((r) => ({
  id: Number(r.id),
  src: r.image_url && r.image_url.length > 0 ? r.image_url : null,
}));

console.log(`loaded ${rows.length} rows from csv`);

const PAGE_SIZE = 5000;

for (let i = 0; i < rows.length; i += PAGE_SIZE) {
  console.time("page-process");

  const page = rows.slice(i, i + PAGE_SIZE);
  await processBatchConcurrently(page, CONCURRENCY);

  console.timeEnd("page-process");

  console.log(
    `progress: downloaded=${totalDownloaded} already_exists=${totalAlreadyExists} skipped=${totalSkipped} failed=${totalFailed} processed=${
      i + page.length
    }/${rows.length}`,
  );
}

console.timeEnd("total");
console.log(
  `done. downloaded=${totalDownloaded} already_exists=${totalAlreadyExists} skipped=${totalSkipped} failed=${totalFailed}`,
);