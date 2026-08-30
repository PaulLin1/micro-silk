import {
    AutoTokenizer,
    CLIPTextModelWithProjection,
    type PreTrainedTokenizer,
} from "@huggingface/transformers";

// Xenova/clip-vit-base-patch32 is an ONNX port of the exact same weights as
// openai/clip-vit-base-patch32 (used by ml/retrieve.py and
// ml/embed_to_postgres.py) — same vector space, so text queries computed here
// are directly comparable to the image embeddings stored in block_embeddings.
const MODEL_NAME = "Xenova/clip-vit-base-patch32";

let modelPromise: Promise<{
    tokenizer: PreTrainedTokenizer;
    model: CLIPTextModelWithProjection;
}> | null = null;

function loadModel() {
    if (!modelPromise) {
        modelPromise = (async () => {
            const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
            const model = await CLIPTextModelWithProjection.from_pretrained(
                MODEL_NAME,
                // q8 instead of fp32: ~4x smaller download and far less memory
                // on the 1GB Fly machine, so the first search doesn't stall on a
                // 250MB load and the rest of the app isn't fighting it for RAM.
                // Quantizing only the text tower shifts query vectors
                // negligibly for cosine retrieval against the stored image
                // embeddings.
                { dtype: "q8" },
            );
            return { tokenizer, model };
        })();
    }
    return modelPromise;
}

// Kick off the model load at server boot (fire-and-forget) so the first user
// search hits a warm cache instead of paying the whole download + init cost.
export function warmClipModel(): void {
    loadModel().catch((err) =>
        console.error("clip model warmup failed:", err),
    );
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
