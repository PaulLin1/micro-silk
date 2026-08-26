import path from "node:path";
import {
    AutoTokenizer,
    CLIPTextModelWithProjection,
    env,
    type PreTrainedTokenizer,
} from "@huggingface/transformers";

// Xenova/clip-vit-base-patch32 is an ONNX port of the exact same weights as
// openai/clip-vit-base-patch32 (used by ml/retrieve.py and
// ml/embed_to_postgres.py) — same vector space, so text queries computed here
// are directly comparable to the image embeddings stored in block_embeddings.
const MODEL_NAME = "Xenova/clip-vit-base-patch32";

// The weights + tokenizer are vendored in models/ (see scripts/fetch_clip_model.mjs)
// and copied into the serverless function by next.config.ts's
// outputFileTracingIncludes. Never reach for the HuggingFace Hub at runtime.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(process.cwd(), "models");

let modelPromise: Promise<{
    tokenizer: PreTrainedTokenizer;
    model: CLIPTextModelWithProjection;
}> | null = null;

function loadModel() {
    if (!modelPromise) {
        modelPromise = (async () => {
            const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
            // "q8" -> onnx/text_model_quantized.onnx. int8-quantizing only the
            // text tower perturbs query vectors slightly but keeps them in the
            // same CLIP space; cosine ranking against the fp32 image embeddings
            // is unaffected in practice, and it's the only variant small enough
            // to vendor without git-lfs. Runs on the native onnxruntime-node
            // backend (device defaults to "cpu").
            const model = await CLIPTextModelWithProjection.from_pretrained(
                MODEL_NAME,
                { dtype: "q8" },
            );
            return { tokenizer, model };
        })();
    }
    return modelPromise;
}

function l2Normalize(vec: Float32Array): number[] {
    let normSq = 0;
    for (const v of vec) normSq += v * v;
    const norm = Math.sqrt(normSq);
    return Array.from(vec, (v) => v / norm);
}

// Text -> unit-normalized 512-dim CLIP embedding, for cosine similarity
// against block_embeddings.embedding (magic search).
export async function embedText(text: string): Promise<number[]> {
    const { tokenizer, model } = await loadModel();
    const inputs = tokenizer([text], { padding: true, truncation: true });
    const { text_embeds } = await model(inputs);
    return l2Normalize(text_embeds.data as Float32Array);
}

// pgvector's text input format for a `vector` column: '[v1,v2,...]'
export function toVectorLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
}
