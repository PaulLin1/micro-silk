# micro-silk

A search app over an Are.na dataset: images are crawled from Are.na, embedded with
a CLIP-based model, and served through both plain-text and semantic ("Magic
Search") retrieval.

## Stack

- **App**: React Router 8 (SSR), Tailwind, deployed as a Node server (see `Dockerfile` / `fly.toml`)
- **Database**: Postgres + [pgvector](https://github.com/pgvector/pgvector), schema in `app/db/schema.ts`, migrations via [drizzle-kit](https://orm.drizzle.team/kit-docs/overview)
- **Images**: stored in Cloudflare R2, served through `app/routes/image.tsx` / `app/r2.server.ts`
- **Search**: `app/routes/search.tsx` embeds the query with CLIP (`app/clip.server.ts`) and ranks `block_embeddings` by cosine distance; falls back to `ILIKE` text search if no embeddings exist yet for the current space version
- **ML pipeline**: `ml/` trains the embedding space itself — see `ml/README.md` and `ml/ARCHITECTURE.md`

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, R2_*, ARENA_TOKEN
npm run dev
```

## Data pipeline (rough order)

```bash
npm run ingest_arena      # crawl Are.na -> {blocks,channels,connections,users}.csv
npm run load_csv          # csv -> Postgres
npm run download_images   # crawl image bytes
npm run upload_to_r2      # images -> R2

npm run db:push           # (first time / schema changes) apply app/db/schema.ts to Postgres

cd ml && uv run python embed_to_csv.py                 # frozen CLIP -> ml/embeddings.csv
cd ml && uv run python load_embeddings_to_postgres.py  # csv -> block_embeddings
```

`ml/` has its own README covering the embedding-space training pipeline in depth —
that part is decoupled from the app and only shares the Postgres schema.

## Scripts

| script | what it does |
|---|---|
| `npm run dev` | dev server with HMR |
| `npm run build` / `npm run start` | production build / serve |
| `npm run typecheck` | `react-router typegen` + `tsc` |
| `npm run db:generate` | generate a drizzle migration from `app/db/schema.ts` |
| `npm run db:push` | push `app/db/schema.ts` directly to the configured `DATABASE_URL` |
| `npm run ingest_arena` | crawl Are.na into `*.csv` |
| `npm run load_csv` | load the crawl CSVs into Postgres |
| `npm run download_images` | download block image bytes locally |
| `npm run upload_to_r2` | upload downloaded images to R2 |

## Deployment

Ships as a multi-stage Docker image (`Dockerfile`) to Fly.io (`fly.toml`). The
container only needs `DATABASE_URL` and the `R2_*` / `ARENA_TOKEN` env vars set on
the target platform — nothing is baked into the image.
