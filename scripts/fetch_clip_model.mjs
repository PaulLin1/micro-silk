// Downloads the CLIP text-encoder weights + tokenizer that app/lib/clip.ts loads
// at request time. We vendor these into models/ (committed) so a deploy never
// depends on the HuggingFace Hub being reachable at build or runtime.
//
//   node scripts/fetch_clip_model.mjs
//
// Must stay in sync with MODEL_NAME / dtype in app/lib/clip.ts.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = "Xenova/clip-vit-base-patch32";
const REVISION = "main";
// dtype "q8" in transformers.js resolves to the "_quantized" file suffix.
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.json",
  "merges.txt",
  "onnx/text_model_quantized.onnx",
];

const outRoot = path.join(process.cwd(), "models", REPO);

for (const file of FILES) {
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
  const dest = path.join(outRoot, file);
  await mkdir(path.dirname(dest), { recursive: true });

  process.stdout.write(`↓ ${file} … `);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1_000_000).toFixed(1)} MB`);
}

console.log(`\nDone → ${outRoot}`);
