# micro-silk ML — a geometry-aware taste embedding space

Trains a small projection head on top of frozen CLIP so that **one** vector space
serves all four product features: **Search**, **Trails**, **Map**, **Suggestions**.

Search only needs nearest-neighbour retrieval to be correct. Trails, Map and
Suggestions additionally assume the space is well-spread and locally linear —
interpolating between two items and averaging a web's vectors only mean something
if the space behaves like a well-formed manifold rather than a lumpy cone. Vanilla
CLIP is anisotropic (embeddings clump into a narrow cone of the hypersphere),
which is exactly the regime where centroids and interpolation degrade. So the
training objective optimizes **geometry**, not just retrieval.

Scope is this folder. It consumes CSV exports and emits versioned embedding
artifacts. The app-side pgvector schema and API routes are separate work.

---

## Pipeline

```
data.export_graph  ->  data/*.csv                 Postgres -> CSV (needs DATABASE_URL)
encode.base_clip   ->  artifacts/base/*.npy       frozen CLIP, computed ONCE
data.dedup         ->  artifacts/dedup.json       near-duplicate groups
data.splits        ->  artifacts/splits.json      block-level + channel-level holdout
train              ->  artifacts/<version>/head.pt
eval.report        ->  reports/<version>.md       THE RELEASE GATE
infer.embed_corpus ->  artifacts/<version>/embeddings.npy + manifest.json
infer.project_map  ->  artifacts/<version>/map_*.npy
```

Order matters in two places: `base_clip` before `dedup`/`splits` (the split must be
over ids that genuinely have embeddings, not over CSV rows), and `dedup` before
`splits` (so a held-out block's near-copies are held out with it).

## Setup

```bash
cd ml
uv sync
```

Torch resolves to CUDA 12.6 wheels on Linux and to plain PyPI (MPS/CPU) elsewhere,
so the same project installs on a Mac for smoke tests.

Paths come from env vars — nothing is hardcoded:

| var | meaning | GPU box |
|---|---|---|
| `SILK_IMAGE_DIR` | where `{block_id}.jpg` live | `/mnt/scratch/linpaul1/micro-silk/images` |
| `SILK_DATA_DIR` | exported graph CSVs | `ml/data` |
| `SILK_ARTIFACT_DIR` | base features + versioned spaces | `ml/artifacts` |
| `SILK_REPORT_DIR` | eval reports | `ml/reports` |
| `DATABASE_URL` | only `data.export_graph` needs it | from repo-root `.env` |

## Runbook

Export the graph wherever the database is reachable, then rsync `ml/data/` to the
GPU box. The training box never needs database access.

```bash
uv run python -m silk.data.export_graph
```

On the GPU box:

```bash
export SILK_IMAGE_DIR=/mnt/scratch/linpaul1/micro-silk/images

uv run python -m silk.encode.base_clip          # ~121k images, minutes; ONCE
uv run python -m silk.data.dedup
uv run python -m silk.data.splits

uv run python -m silk.train                     # seconds per epoch
uv run python -m silk.eval.report --umap        # the gate
uv run python -m silk.infer.embed_corpus
uv run python -m silk.manifest verify artifacts/<space_version>
uv run python -m silk.infer.project_map
```

Then eyeball it:

```bash
uv run python -m silk.infer.search  --query "drain gang" --grids
uv run python -m silk.infer.trails  --from <id> --to <id> --steps 6 --grid
uv run python -m silk.infer.suggest --channel-id <id> -k 10 --grid
```

## Design

### The head

```
z = normalize(x + alpha * MLP(x))        # 512 -> 1024 -> 512, GELU
```

- **Final layer zero-initialized**, so at step 0 the head is *exactly* the
  identity. Epoch-0 metrics equal the raw-CLIP baseline by construction, every
  reported number is a measured delta, and a bad run degrades toward CLIP rather
  than into noise. `train.py` asserts this and refuses to start otherwise.
- **Residual**, which bounds drift and preserves the general visual knowledge that
  not-full-fine-tuning was meant to protect.
- **Shared across modalities.** The same head transforms image *and* text features.
  Load-bearing, not cosmetic — see failure mode 1 below.

### Loss

| term | for | flag (default) |
|---|---|---|
| `info_nce_masked` | retrieval correctness | `--w-infonce` (1.0) |
| `uniformity` | spread over the hypersphere | `--w-uniform` (0.1) |
| `centroid_member` | averaged vectors retrieve well | `--w-centroid` (0.5) |
| `crossmodal_preserve` | text↔image stays aligned | `--w-crossmodal` (0.2) |

Those defaults are **starting points, not claims** — the eval harness is the
arbiter. An epoch takes seconds, so this is meant to be iterated.

`centroid_member` is the one worth calling out: nothing in pairwise co-occurrence
tells the model that a web's mean vector should retrieve its members, so without
it Suggestions is relying on linearity as a hoped-for emergent property. The
channels already exist, so training on it directly is nearly free.

### Four failure modes this is built around

**1. Training on images alone breaks Search.** CLIP's text and image embeddings
share a space, which is what makes text→image search work. Transform only the image
side and text queries stay in raw CLIP space while items move to head space — the
two stop being comparable and Search degrades silently, because every
image-to-image metric still looks fine. Hence the shared head plus
`crossmodal_preserve`, and a search-preservation check that gates release.

**2. `connections` is bipartite, not item-item.** The schema stores
`(block_id, channel_id)` membership; there is no item↔item edge table. Positives
are derived — two blocks sharing a channel. Two consequences:

- Sampling is **anchor-centric**: one epoch touches every block once as an anchor.
  Enumerating all within-channel pairs is ~40M and is dominated by the largest few
  channels.
- In-batch negatives contain **true positives**. With only ~500 channels two random
  blocks share one often enough to matter, and unmasked InfoNCE would push apart
  items the labels call similar. `PairSampler.batch_mask` computes the exact B×B
  co-membership matrix per batch and the loss masks those logits. `train.py` fails
  loudly if the mask never fires.

**3. Blank-image substitution poisons the space.** The original
`finetune_clip_head.py` substituted `Image.new("RGB", (224,224))` on decode
failure. That yields a valid-looking embedding, and N identical blank vectors form
a dense fake cluster that hoovers up neighbours and inflates every metric.
`encode.base_clip` records and excludes failures instead, and prints a
reconciliation that must sum exactly:

```
csv_rows = embedded + empty_image_url + missing_file_on_disk + decode_failures
```

**4. Near-duplicates inflate everything.** Are.na reposting means a held-out block's
nearest neighbour is often a byte-identical copy. `data.dedup` groups them, splits
keep whole groups on one side, and eval scores over groups rather than rows. The
report prints `retrieval_no_dedup.hit_rate@10` so you can see how much it mattered.

### Splits

Primary holdout is **block-level** (~5%): production embeds a *new* block and needs
it to land correctly, and since the head sits on frozen features an unseen block
still gets a vector. Secondary is ~25 **fully held-out channels**, used only for the
centroid / Suggestions metric.

### The gate

`eval.report` runs raw CLIP and the head through the identical code path. A space
ships only if all five hold:

1. retrieval `hit_rate@10` > baseline
2. centroid `hit_rate@10` > baseline
3. `mean_pair_cosine` < baseline (less anisotropic)
4. `effective_rank` > baseline (more dimensions in use)
5. `top50_overlap` >= `--min-search-overlap`

Criteria 3–4 exist because retrieval can improve while the space stays a lumpy cone
— in which case Search got better and the other three features got nothing.
Acceptance is deliberately **relative**; there is no invented target number.

Built-in sanity check: the baseline's `top50_overlap` must be exactly `1.0000`. If
it isn't, the harness is misconfigured and no other number is trustworthy.

There is no pytest suite here. **The eval report is the test** — commit
`reports/<version>.md` per run so successive runs stay comparable.

### Inference geometry

**Trails** use slerp. A precise note, since the usual justification is slightly off:
`normalize(lerp(a,b,t))` and `slerp(a,b,t)` trace the *same great-circle arc* —
renormalizing already removes any "the chord dips through a distorted interior"
concern, because after normalization there is no interior. The real reason for
slerp is **uniform angular spacing**: normalized-lerp bunches waypoints toward the
midpoint, giving uneven steps. Trails also add a bonus for sharing a channel with
the previous step, so a trail reads as curated rabbit-holing rather than a
slideshow of visually similar images.

**Suggestions** use `normalize(mean(unit member vectors))` — exactly the quantity
`losses.centroid_member` trained against — then MMR re-rank, because pure
centroid-kNN returns k variations on the web's densest cluster.

**Map** is UMAP (cosine, `n_neighbors=30`, `min_dist=0.05`) plus HDBSCAN, with each
cluster named by the channel titles most over-represented in it by lift. Real names
a human wrote while curating; no LLM. Worth running as a **training diagnostic**
long before the Map feature is built — if the projection is mush, the uniformity
term is too weak and Trails and Suggestions are getting nothing either.

### Versioning

`space_version = <model-slug>_<hash of head+loss config>_<tag>`. Vectors are written
unit-norm float32 as `embeddings.npy` plus ascending `ids.npy`, with a
`manifest.json` recording the model, config, weight hash, git SHA, duplicate-group
count and exclusion counts.

**Any retrain requires a full corpus re-embed into a new directory — never a partial
backfill.** All four features read the same space; a corpus half in v1 and half in
v2 does not error, it quietly returns nonsense, because cosine between incomparable
vectors still produces a plausible-looking number. `embed_corpus` refuses to write
into a directory whose name disagrees with the checkpoint's config hash, and
`silk.manifest verify` checks norms, uniqueness, ordering and NaNs.

## Notes on what was here before

- `finetune_clip_head.py` (removed) contained **no training code** despite its name
  — it was a zero-shot search demo. Its `get_device`, dataset/collate and
  `save_result_grid` live on in `silk/device.py`, `silk/encode/base_clip.py` and
  `silk/infer/search.py`.
- `taste_head.pt` is an **orphan** (512→256→512) from a trainer that was never
  committed. Nothing loads it. New checkpoints go to `artifacts/<version>/head.pt`.
- `demo_results/*.png` are the raw-CLIP baseline grids — keep them; `infer.search
  --grids` output is meant to be compared against them.
- `_features()` in `encode/base_clip.py` unwraps `get_*_features`, which returns a
  bare Tensor on transformers 4.x and `BaseModelOutputWithPooling` on 5.x. In both
  cases the value is **already projected** into the shared 512-d space (verified:
  cosine 1.0 against `CLIPModel.forward()`'s embeds, which differ only by
  pre-normalization). Do not apply `visual_projection`/`text_projection` again.
- The `download_metadata` npm script in the repo root points at a file that does not
  exist. The metadata it implies is covered by `silk.data.export_graph`.
