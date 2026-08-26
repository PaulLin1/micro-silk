# micro-silk

A recreation of Silk, built on are.na data.

- **Framework:** Next.js 16 (App Router)
- **DB:** Neon Postgres + pgvector, via Drizzle (`drizzle-orm/neon-http`)
- **Images:** Cloudflare R2, proxied through `/i/[id]`
- **Magic Search:** CLIP text embeddings (`Xenova/clip-vit-base-patch32`, int8)
  run in-process with `@huggingface/transformers`, ranked by pgvector cosine
  distance. Weights are vendored in `models/` — see below.
- **Hosting:** Vercel

## Develop

```bash
npm install
npm run dev
```

Needs a `.env` with `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Routes

| Route        | What                                                          |
| ------------ | ------------------------------------------------------------- |
| `/`          | Randomized image feed, infinite scroll via `/api/blocks`     |
| `/search`    | Semantic "Magic Search" over block image embeddings          |
| `/i/[id]`    | Image proxy for R2 object `{id}.jpg`                         |
| `/chats`     | WIP                                                          |

## The CLIP model

`models/Xenova/clip-vit-base-patch32/` holds the text-encoder weights +
tokenizer, committed so builds and cold starts never depend on the HuggingFace
Hub. Regenerate with:

```bash
npm run fetch_clip_model
```

`next.config.ts` copies this directory (and onnxruntime-node's linux/x64
prebuild) into the `/search` serverless function via `outputFileTracingIncludes`.

## Data pipeline (offline, not deployed)

`scripts/` ingests are.na data into Postgres and uploads images to R2. `ml/` is
a separate Python project that computes the image embeddings. Neither runs on
Vercel.

```bash
npm run ingest_arena        # crawl are.na -> Postgres
npm run load_csv            # backfill from CSV dumps
npm run download_images     # pull block images locally
npm run upload_to_r2        # push images to R2
npm run db:generate         # drizzle migrations
npm run db:push
```
