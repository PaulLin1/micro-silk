import { useCallback, useEffect, useRef, useState } from "react";
import { blockImageSrc } from "~/arena-image";

/*
  Ambient preview mode — ported from linpaul.com's background collage
  (app/components/RandomImages.tsx there). A full-screen field of images from
  the collection. One image is swapped per tick, so the collage turns over its
  full set roughly every SLOTS * TICK. Lifespan is derived from TICK to keep
  that balance, so TICK is the only dial worth turning here.

  The one structural change from the original: the image pool isn't a fixed
  range of local files — it's fetched from the /ambient resource route, and the
  swap loop pools over the indices of whatever blocks come back.

  Rendered by the feed (app/welcome/welcome.tsx) as one of two feed views, in
  place of the masonry grid. Fills its positioned parent.
*/
const COLS = 5;
const ROWS = 3;
const SLOTS = COLS * ROWS;
const TICK = 1000;
const IMAGE_LIFESPAN = SLOTS * TICK;
const FADE = 1.2;
const FADE_MS = FADE * 1000;
/** An image can't return until its old copy is off screen for good. */
const REUSE_COOLDOWN = FADE_MS + 2000;
/** A gap this much longer than a tick means the tab was hidden, not that time passed. */
const STALL = TICK * 3;

const WIDTHS = [220, 280, 340, 400];
const HEIGHTS = [170, 210, 260, 320];

type AmbientBlock = { id: number; imageUrl?: string | null };

interface CollageImage {
    src: string;
    width: number;
    height: number;
    key: string;
    /** Index into the fetched block pool. */
    n: number;
    /** Which grid cell this image holds. One image per cell, so they spread out. */
    cell: number;
    /** Position as a 0..1 fraction of the free space, so it survives a resize. */
    fx: number;
    fy: number;
    lifespan: number;
    /** Set when the image goes on screen, never when it's built — see `show`. */
    expiresAt: number;
    /** Fading out. It still renders, but has given up its cell. */
    exiting: boolean;
    /** When to drop it from the DOM: once the fade-out has finished. */
    removeAt: number;
}

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** A point inside `cell`, inset from its edges so neighbours don't stack up. */
function positionIn(cell: number): { fx: number; fy: number } {
    const col = cell % COLS;
    const row = Math.floor(cell / COLS);
    const jitter = () => 0.15 + Math.random() * 0.7;
    return { fx: (col + jitter()) / COLS, fy: (row + jitter()) / ROWS };
}

function makeImage(n: number, src: string, cell: number, lifespan: number): CollageImage {
    return {
        src,
        width: pick(WIDTHS),
        height: pick(HEIGHTS),
        key: `${n}-${cell}-${Math.random()}`,
        n,
        cell,
        ...positionIn(cell),
        lifespan,
        expiresAt: Infinity,
        exiting: false,
        removeAt: Infinity,
    };
}

/**
 * Start an image's clock at the moment it goes on screen. Stamping it at build
 * time instead means a slow preload eats into the lifespan, and the image can
 * land already expired — which looks like a flash.
 */
function show(img: CollageImage, now: number): CollageImage {
    return { ...img, expiresAt: now + img.lifespan };
}

/** Resolves once the browser actually has the bitmap, so the fade-in can't pop. */
function preload(src: string): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
    });
}

export function AmbientCollage({
    blocks,
    onExit,
}: {
    /** Image pool. Omit to draw a random pool from the whole collection. */
    blocks?: AmbientBlock[];
    onExit?: () => void;
}) {
    const [images, setImages] = useState<CollageImage[]>([]);
    // The opening set is on screen. Until then the swap loop must stay parked,
    // or it fills the empty collage with images the opening set then wipes.
    const [seeded, setSeeded] = useState(false);

    // Pool of blocks fetched from /ambient. `n` values above index into this.
    const poolRef = useRef<AmbientBlock[]>([]);
    const srcOf = useCallback(
        (n: number) => blockImageSrc(poolRef.current[n], 700),
        [],
    );

    // The loop reads and writes the collage across an await, so the live set
    // lives in a ref; state exists only to render it.
    const imagesRef = useRef<CollageImage[]>([]);
    /** pool index -> the time it's allowed to be shown again. */
    const cooldownRef = useRef<Map<number, number>>(new Map());
    const lastTickRef = useRef(0);

    const commit = useCallback((next: CollageImage[]) => {
        imagesRef.current = next;
        setImages(next);
    }, []);

    /** A pool index that's neither on screen nor still fading out. */
    const freeNumber = useCallback((now: number): number | null => {
        const total = poolRef.current.length;
        if (total === 0) return null;
        const onScreen = new Set(imagesRef.current.map((img) => img.n));
        const available: number[] = [];
        for (let n = 0; n < total; n++) {
            if (onScreen.has(n)) continue;
            const until = cooldownRef.current.get(n);
            if (until === undefined) {
                available.push(n);
                continue;
            }
            if (until > now) continue;
            cooldownRef.current.delete(n);
            available.push(n);
        }
        return available.length > 0 ? pick(available) : null;
    }, []);

    // Esc drops back to the masonry feed.
    useEffect(() => {
        if (!onExit) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onExit();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onExit]);

    // Resolve the pool (given blocks, else a random draw from /ambient), then
    // decode and show the opening set.
    useEffect(() => {
        let cancelled = false;

        (async () => {
            let pool: AmbientBlock[] = blocks ?? [];
            if (pool.length === 0) {
                try {
                    const r = await fetch("/ambient", {
                        headers: { Accept: "application/json" },
                    });
                    pool = (await r.json()).blocks ?? [];
                } catch {
                    pool = [];
                }
            }
            if (cancelled || pool.length === 0) return;
            pool = pool.filter((b) => b && b.imageUrl);
            if (pool.length === 0) return;
            poolRef.current = pool;

            const indices = Array.from({ length: pool.length }, (_, i) => i);
            const taken = new Set<number>();
            const initial: CollageImage[] = [];
            for (let cell = 0; cell < SLOTS; cell++) {
                let n = pick(indices);
                let guard = 0;
                while (taken.has(n) && guard++ < 50) n = pick(indices);
                taken.add(n);
                // Stagger the first batch's expiries across one lifespan, else
                // the whole set dies on the same tick and the screen empties.
                initial.push(
                    makeImage(n, srcOf(n), cell, IMAGE_LIFESPAN * (0.3 + cell / SLOTS)),
                );
            }

            // Show the opening set only once it's decoded, so it fades in
            // cleanly instead of images popping in at network rate.
            const loaded = await Promise.all(initial.map((img) => preload(img.src)));
            if (cancelled) return;
            const now = Date.now();
            commit(initial.filter((_, i) => loaded[i]).map((img) => show(img, now)));
            lastTickRef.current = now;
            setSeeded(true);
        })();

        return () => {
            cancelled = true;
        };
    }, [blocks, commit, srcOf]);

    useEffect(() => {
        if (!seeded) return;
        let cancelled = false;

        const interval = setInterval(async () => {
            const now = Date.now();
            const gap = now - lastTickRef.current;
            lastTickRef.current = now;

            // Background tabs get their timers throttled. Without this, coming
            // back to the tab expires the whole collage at once and it visibly
            // wipes; instead, treat the hidden stretch as time that didn't pass.
            if (gap > STALL) {
                commit(
                    imagesRef.current.map((img) => ({
                        ...img,
                        expiresAt: img.expiresAt + gap,
                        removeAt: img.removeAt + gap,
                    })),
                );
                return;
            }

            const next = imagesRef.current
                .filter((img) => img.removeAt > now)
                .map((img) => {
                    if (img.exiting || img.expiresAt > now) return img;
                    cooldownRef.current.set(img.n, now + REUSE_COOLDOWN);
                    return { ...img, exiting: true, removeAt: now + FADE_MS };
                });

            const live = next.filter((img) => !img.exiting);
            if (live.length >= SLOTS) {
                commit(next);
                return;
            }

            const usedCells = new Set(live.map((img) => img.cell));
            const freeCells = [...Array(SLOTS).keys()].filter((c) => !usedCells.has(c));
            const n = freeNumber(now);
            if (freeCells.length === 0 || n === null) {
                commit(next);
                return;
            }

            // One image in per tick: replacing every free cell at once reads as
            // a flicker rather than a collage rearranging itself.
            const incoming = makeImage(n, srcOf(n), pick(freeCells), IMAGE_LIFESPAN);
            commit(next);

            if (!(await preload(incoming.src)) || cancelled) return;

            const current = imagesRef.current;
            const conflict = current.some(
                (img) => img.n === n || (!img.exiting && img.cell === incoming.cell),
            );
            if (conflict) return;
            commit([...current, show(incoming, Date.now())]);
        }, TICK);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [seeded, commit, freeNumber, srcOf]);

    return (
        <div className="absolute inset-0 overflow-hidden bg-paper">
            {seeded && (
                <div
                    aria-hidden
                    className="collage"
                    style={{ "--collage-fade": `${FADE}s` } as React.CSSProperties}
                >
                    {images.map((img) => (
                        <img
                            key={img.key}
                            className="collage__img"
                            src={img.src}
                            alt=""
                            decoding="async"
                            style={{
                                width: `min(${img.width}px, 45vw)`,
                                height: `min(${img.height}px, 30vh)`,
                                left: `calc((100% - min(${img.width}px, 45vw)) * ${img.fx})`,
                                top: `calc((100% - min(${img.height}px, 30vh)) * ${img.fy})`,
                                opacity: img.exiting ? 0 : undefined,
                            }}
                        />
                    ))}
                </div>
            )}

            {!seeded && (
                <div className="absolute inset-0 grid place-items-center text-sm text-ink-soft">
                    gathering images…
                </div>
            )}
        </div>
    );
}
