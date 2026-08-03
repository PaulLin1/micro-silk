import "dotenv/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as HttpsAgent } from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const CONCURRENCY = 64; // tune: 32-128 depending on file size/network
const FOLDER = "/mnt/scratch/linpaul1/micro-silk/images";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  maxAttempts: 5, // built-in retry w/ backoff
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    socketTimeout: 30000,
    // keep-alive + a big enough pool that CONCURRENCY isn't starved for sockets
    httpsAgent: new HttpsAgent({
        keepAlive: true,
        maxSockets: CONCURRENCY * 2,
        }),
  }),
});

async function uploadFile(file: string) {
  const filePath = path.join(FOLDER, file);
  const stat = await fsp.stat(filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: file,
      Body: fs.createReadStream(filePath), // stream, don't buffer whole file
      ContentType: "image/jpeg",
      ContentLength: stat.size, // required by SDK when body is a stream
    })
  );
}

// simple concurrency pool, no extra deps
async function runPool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let idx = 0;
  let done = 0;
  const total = items.length;

  const workers = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      try {
        await fn(item, i);
      } catch (err) {
        console.error(`FAILED ${item}:`, (err as Error).message);
      }
      done++;
      if (done % 500 === 0 || done === total) {
        console.log(`${done}/${total}`);
      }
    }
  });

  await Promise.all(workers);
}

async function main() {
  const files = (await fsp.readdir(FOLDER)).filter((f) =>
    f.toLowerCase().endsWith(".jpg")
  );

  console.log(`Uploading ${files.length} files with concurrency=${CONCURRENCY}`);
  await runPool(files, CONCURRENCY, uploadFile);
  console.log("Done.");
}

main().catch(console.error);