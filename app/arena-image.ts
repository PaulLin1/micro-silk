// are.na serves images through a resizer at images.are.na/<base64-json>, where
// the JSON describes the source object and an `edits` pipeline (resize, format,
// quality). The URLs stored in blocks.image_url ask for 400px. We can decode
// that JSON, swap in a smaller resize + cheaper quality, and re-encode — giving
// us a much lighter thumbnail served straight from are.na's CDN, no proxy.
//
// Isomorphic: uses atob/btoa (global in browsers and Node 18+). The resizer
// JSON is pure ASCII so btoa is safe; anything unexpected falls back to null.

type ArenaEdits = {
    resize?: Record<string, unknown>;
    webp?: Record<string, unknown>;
    jpeg?: Record<string, unknown>;
    [k: string]: unknown;
};

/**
 * @param imageUrl the stored are.na image URL (or null)
 * @param size     target max edge in CSS px — pass the displayed size; callers
 *                 that want crispness on HiDPI should pass ~1.5–2× that
 * @returns a rewritten images.are.na URL, or null if `imageUrl` isn't an
 *          are.na resizer URL we can safely rewrite (caller should fall back)
 */
export function arenaImage(imageUrl: string | null | undefined, size: number): string | null {
    if (!imageUrl) return null;
    const prefix = "https://images.are.na/";
    if (!imageUrl.startsWith(prefix)) return null;

    const token = imageUrl.slice(prefix.length).split(/[?#]/)[0];
    try {
        const json = JSON.parse(atob(token)) as { edits?: ArenaEdits };
        const edits: ArenaEdits = json.edits ?? {};
        edits.resize = {
            width: size,
            height: size,
            fit: "inside",
            withoutEnlargement: true,
        };
        edits.webp = { quality: 62 };
        edits.jpeg = { quality: 68 };
        json.edits = edits;
        return prefix + btoa(JSON.stringify(json));
    } catch {
        return null;
    }
}

/** Best available src for a block at a given display size: are.na thumb, else
 *  the `/i/:id` proxy (full-size R2 asset). */
export function blockImageSrc(
    block: { id: number; imageUrl?: string | null },
    size: number,
): string {
    return arenaImage(block.imageUrl, size) ?? `/i/${block.id}`;
}
