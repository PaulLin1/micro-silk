import { useCallback, useEffect, useRef, useState } from "react";
import { blockImageSrc } from "~/arena-image";
import type { Neighbourhood, WebNode } from "~/explore.server";

const NODE = 132; // neighbour image size (px)
const ROOT_NODE = 172;
const RING_R = 370; // parent → child distance
const DEPTH_STEP = 46; // extra radius per depth level
const ROOT_FANOUT = 7;
const CHILD_FANOUT = 4;
const MAX_NODES = 42;

const SPRING = 0.06; // pull toward radial target
const DAMP = 0.84; // per-frame velocity retention (lower = calmer settle)
const MAX_V = 42; // px per frame speed cap
const COLLIDE_PAD = 18; // gap kept between image edges
const PAN_FRICTION = 0.9;
const DRAG_THRESHOLD = 4;

type SimNode = {
    id: number;
    title: string | null;
    imageUrl: string | null;
    x: number;
    y: number;
    vx: number;
    vy: number;
    tx: number;
    ty: number;
    parent: number | null;
    depth: number;
    born: number; // ms — starts moving/appearing at this time
    dead: number; // ms — culled at this time (0 = alive)
};

const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const edgeEnds = (k: string): [number, number] => {
    const i = k.indexOf("-");
    return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

async function fetchNeighbours(
    id: number,
    n: number,
): Promise<Neighbourhood | { error: string }> {
    try {
        const r = await fetch(`/explore/${id}?n=${n}`, {
            headers: { Accept: "application/json" },
        });
        return await r.json();
    } catch {
        return { error: "network" };
    }
}

export function ExploreWeb({
    rootId,
    onPick,
}: {
    rootId: number;
    onPick: (id: number) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);

    const nodes = useRef<Map<number, SimNode>>(new Map());
    const edges = useRef<Set<string>>(new Set());
    const expanding = useRef<Set<number>>(new Set());
    const nodeEls = useRef<Map<number, HTMLElement>>(new Map());
    const edgeEls = useRef<Map<string, HTMLElement>>(new Map());

    const view = useRef({ x: 0, y: 0 });
    const vel = useRef({ x: 0, y: 0 });
    const rafId = useRef<number | null>(null);
    const dragged = useRef(false);
    const viewport = useRef({ w: 0, h: 0 });
    const lastFrontier = useRef(0);
    const killed = useRef(false);

    const [, forceRender] = useState(0);
    const rerender = useCallback(() => {
        if (!killed.current) forceRender((n) => n + 1);
    }, []);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
        "loading",
    );

    const applyView = useCallback(() => {
        const w = worldRef.current;
        if (w) {
            w.style.transform = `translate3d(${view.current.x}px, ${view.current.y}px, 0)`;
        }
    }, []);

    const fadeWorld = useCallback((to: number) => {
        const w = worldRef.current;
        if (w) w.style.opacity = String(to);
    }, []);

    const dropNode = useCallback((id: number) => {
        nodes.current.delete(id);
        nodeEls.current.delete(id);
        expanding.current.delete(id);
        for (const k of [...edges.current]) {
            const [a, b] = edgeEnds(k);
            if (a === id || b === id) {
                edges.current.delete(k);
                edgeEls.current.delete(k);
            }
        }
    }, []);

    // --- simulation -------------------------------------------------------

    const kick = useCallback(() => {
        if (rafId.current != null || killed.current) return;
        let last = performance.now();

        const radiusOf = (n: SimNode) =>
            (n.depth === 0 ? ROOT_NODE : NODE) / 2;

        const tick = (now: number) => {
            const dt = Math.min(2, Math.max(0.4, (now - last) / 16.667));
            last = now;

            const alive: SimNode[] = [];
            for (const n of nodes.current.values()) if (!n.dead) alive.push(n);

            let moving = false;
            const damp = Math.pow(DAMP, dt);
            const startX = alive.map((n) => n.x);
            const startY = alive.map((n) => n.y);

            // 1. ease each node toward its radial target
            for (const n of alive) {
                if (n.depth === 0) {
                    n.x = 0;
                    n.y = 0;
                    n.vx = 0;
                    n.vy = 0;
                    continue;
                }
                if (now < n.born) {
                    moving = true;
                    continue;
                }
                n.vx = (n.vx + (n.tx - n.x) * SPRING * dt) * damp;
                n.vy = (n.vy + (n.ty - n.y) * SPRING * dt) * damp;
                const sp = Math.hypot(n.vx, n.vy);
                if (sp > MAX_V) {
                    n.vx = (n.vx / sp) * MAX_V;
                    n.vy = (n.vy / sp) * MAX_V;
                }
                n.x += n.vx * dt;
                n.y += n.vy * dt;
            }

            // 2. resolve overlaps — pure position correction, and cancel the
            //    velocity that's driving nodes into each other, so contacts
            //    settle instead of buzzing.
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 0; i < alive.length; i++) {
                    const a = alive[i];
                    if (now < a.born + 110) continue;
                    for (let j = i + 1; j < alive.length; j++) {
                        const b = alive[j];
                        if (now < b.born + 110) continue;
                        const minD = radiusOf(a) + radiusOf(b) + COLLIDE_PAD;
                        let dx = b.x - a.x;
                        let dy = b.y - a.y;
                        let d2 = dx * dx + dy * dy;
                        if (d2 >= minD * minD) continue;
                        let d = Math.sqrt(d2);
                        if (d < 0.01) {
                            dx = Math.random() - 0.5;
                            dy = Math.random() - 0.5;
                            d = Math.hypot(dx, dy) || 1;
                        }
                        const ux = dx / d;
                        const uy = dy / d;
                        const overlap = minD - d;
                        const aRoot = a.depth === 0;
                        const bRoot = b.depth === 0;
                        if (aRoot) {
                            b.x += ux * overlap;
                            b.y += uy * overlap;
                        } else if (bRoot) {
                            a.x -= ux * overlap;
                            a.y -= uy * overlap;
                        } else {
                            a.x -= ux * overlap * 0.5;
                            a.y -= uy * overlap * 0.5;
                            b.x += ux * overlap * 0.5;
                            b.y += uy * overlap * 0.5;
                        }
                        // kill approach velocity along the contact normal
                        const va = a.vx * ux + a.vy * uy;
                        if (va > 0) {
                            a.vx -= va * ux;
                            a.vy -= va * uy;
                        }
                        const vb = b.vx * ux + b.vy * uy;
                        if (vb < 0) {
                            b.vx -= vb * ux;
                            b.vy -= vb * uy;
                        }
                    }
                }
            }

            // 3. keep animating only while something actually moved this frame
            //    (measured, so a node wedged against a neighbour still settles)
            for (let i = 0; i < alive.length; i++) {
                if (
                    Math.hypot(
                        alive[i].x - startX[i],
                        alive[i].y - startY[i],
                    ) > 0.16
                ) {
                    moving = true;
                    break;
                }
            }

            // nodes
            let fading = false;
            for (const n of nodes.current.values()) {
                const el = nodeEls.current.get(n.id);
                if (!el) continue;
                const size = n.depth === 0 ? ROOT_NODE : NODE;
                el.style.transform = `translate3d(${n.x - size / 2}px, ${n.y - size / 2}px, 0)`;
                if (n.dead) {
                    fading = true;
                    el.style.opacity = String(
                        Math.max(0, 1 - (now - n.dead) / 320),
                    );
                } else {
                    el.style.opacity =
                        now < n.born
                            ? "0"
                            : String(Math.min(1, (now - n.born) / 340));
                }
            }

            // edges (thin rotated divs)
            for (const k of edges.current) {
                const el = edgeEls.current.get(k);
                if (!el) continue;
                const [ai, bi] = edgeEnds(k);
                const a = nodes.current.get(ai);
                const b = nodes.current.get(bi);
                if (!a || !b) {
                    el.style.opacity = "0";
                    continue;
                }
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                const angle = Math.atan2(b.y - a.y, b.x - a.x);
                el.style.width = `${len}px`;
                el.style.transform = `translate3d(${a.x}px, ${a.y}px, 0) rotate(${angle}rad)`;
                const bornGate = Math.min(
                    1,
                    Math.max(0, (now - Math.max(a.born, b.born)) / 340),
                );
                el.style.opacity =
                    a.dead || b.dead
                        ? String(
                              Math.max(
                                  0,
                                  1 -
                                      (now - Math.max(a.dead, b.dead)) / 320,
                              ),
                          )
                        : String(bornGate);
            }

            // pan inertia
            if (Math.abs(vel.current.x) + Math.abs(vel.current.y) > 0.05) {
                view.current.x += vel.current.x;
                view.current.y += vel.current.y;
                vel.current.x *= PAN_FRICTION;
                vel.current.y *= PAN_FRICTION;
                applyView();
                maybeExpandFrontier();
                moving = true;
            }

            if ((moving || fading) && !killed.current) {
                rafId.current = requestAnimationFrame(tick);
            } else {
                rafId.current = null;
            }
        };

        rafId.current = requestAnimationFrame(tick);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applyView]);

    // --- graph growth ----------------------------------------------------

    const addNeighbours = useCallback(
        (parentId: number, neighbours: WebNode[]) => {
            if (killed.current) return;
            const parent = nodes.current.get(parentId);
            if (!parent) return;

            const now = performance.now();

            const gp =
                parent.parent != null
                    ? nodes.current.get(parent.parent)
                    : null;
            const isRoot = parent.depth === 0;
            const base = gp
                ? Math.atan2(parent.ty - gp.ty, parent.tx - gp.tx)
                : -Math.PI / 2;
            const spread = isRoot ? Math.PI * 2 : Math.PI * 1.2;
            const R = RING_R + parent.depth * DEPTH_STEP;

            const fresh: WebNode[] = [];
            for (const nb of neighbours) {
                if (nb.id === parentId) continue;
                if (nodes.current.has(nb.id)) {
                    edges.current.add(edgeKey(parentId, nb.id)); // cross-link
                } else {
                    fresh.push(nb);
                }
            }

            fresh.forEach((nb, i) => {
                const frac = isRoot
                    ? i / fresh.length
                    : fresh.length === 1
                      ? 0.5
                      : i / (fresh.length - 1);
                const angle = isRoot
                    ? base + Math.PI * 2 * frac
                    : base - spread / 2 + spread * frac;
                const j = (Math.random() - 0.5) * 0.18;
                const tx = parent.tx + R * Math.cos(angle + j);
                const ty = parent.ty + R * Math.sin(angle + j);
                nodes.current.set(nb.id, {
                    id: nb.id,
                    title: nb.title,
                    imageUrl: nb.imageUrl,
                    // start a short way along the branch so the spring-out has
                    // a clear direction rather than a pile-up at the parent
                    x: parent.x + (tx - parent.tx) * 0.18,
                    y: parent.y + (ty - parent.ty) * 0.18,
                    vx: 0,
                    vy: 0,
                    tx,
                    ty,
                    parent: parentId,
                    depth: parent.depth + 1,
                    born: now + i * 55,
                    dead: 0,
                });
                edges.current.add(edgeKey(parentId, nb.id));
            });

            // cull nodes furthest from the viewport centre
            const alive = [...nodes.current.values()].filter((n) => !n.dead);
            if (alive.length > MAX_NODES) {
                const cx = viewport.current.w / 2 - view.current.x;
                const cy = viewport.current.h / 2 - view.current.y;
                const victims = alive
                    .filter((n) => n.depth !== 0)
                    .map((n) => ({ n, d2: (n.x - cx) ** 2 + (n.y - cy) ** 2 }))
                    .sort((p, q) => q.d2 - p.d2);
                let over = alive.length - MAX_NODES;
                for (const { n } of victims) {
                    if (over <= 0) break;
                    n.dead = now;
                    expanding.current.delete(n.id);
                    over--;
                }
                // hard-remove the faded-out ones a moment later
                window.setTimeout(() => {
                    if (killed.current) return;
                    const t = performance.now();
                    let changed = false;
                    for (const [id, n] of [...nodes.current]) {
                        if (n.dead && t - n.dead > 500) {
                            dropNode(id);
                            changed = true;
                        }
                    }
                    if (changed) rerender();
                }, 700);
            }

            rerender();
            kick();
        },
        [kick, rerender, dropNode],
    );

    const expand = useCallback(
        async (id: number) => {
            if (expanding.current.has(id) || killed.current) return;
            const node = nodes.current.get(id);
            if (!node || node.dead) return;
            const fanout = node.depth === 0 ? ROOT_FANOUT : CHILD_FANOUT;
            expanding.current.add(id);

            const res = await fetchNeighbours(id, fanout);
            if (killed.current || "error" in res) return;
            const still = nodes.current.get(id);
            if (!still || still.dead) return;
            addNeighbours(id, res.neighbours);
        },
        [addNeighbours],
    );

    const maybeExpandFrontier = useCallback(() => {
        const now = performance.now();
        if (now - lastFrontier.current < 300) return;
        lastFrontier.current = now;

        const { w, h } = viewport.current;
        const vx = view.current.x;
        const vy = view.current.y;
        const visible: { id: number; d2: number }[] = [];
        for (const n of nodes.current.values()) {
            if (n.dead || expanding.current.has(n.id)) continue;
            const sx = n.x + vx;
            const sy = n.y + vy;
            if (sx > -160 && sx < w + 160 && sy > -160 && sy < h + 160) {
                visible.push({
                    id: n.id,
                    d2: (sx - w / 2) ** 2 + (sy - h / 2) ** 2,
                });
            }
        }
        visible.sort((a, b) => a.d2 - b.d2);
        for (const v of visible.slice(0, 2)) expand(v.id);
    }, [expand]);

    // --- (re)build on root change --------------------------------------

    useEffect(() => {
        killed.current = false;
        if (rafId.current != null) cancelAnimationFrame(rafId.current);
        rafId.current = null;
        nodes.current.clear();
        edges.current.clear();
        expanding.current.clear();
        nodeEls.current.clear();
        edgeEls.current.clear();
        vel.current = { x: 0, y: 0 };

        const c = containerRef.current;
        const w = c?.clientWidth || window.innerWidth;
        const h = c?.clientHeight || window.innerHeight;
        viewport.current = { w, h };
        view.current = { x: w / 2, y: h / 2 };
        applyView();
        fadeWorld(0);

        setStatus("loading");
        nodes.current.set(rootId, {
            id: rootId,
            title: null,
            imageUrl: null,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            tx: 0,
            ty: 0,
            parent: null,
            depth: 0,
            born: 0,
            dead: 0,
        });
        rerender();
        kick();

        fetchNeighbours(rootId, ROOT_FANOUT).then((res) => {
            if (killed.current) return;
            if ("error" in res) {
                setStatus("error");
                return;
            }
            const root = nodes.current.get(rootId);
            if (root) {
                root.imageUrl = res.origin.imageUrl;
                root.title = res.origin.title;
            }
            expanding.current.add(rootId);
            setStatus("ready");
            fadeWorld(1);
            addNeighbours(rootId, res.neighbours);
        });

        return () => {
            killed.current = true;
            if (rafId.current != null) cancelAnimationFrame(rafId.current);
            rafId.current = null;
        };
    }, [rootId, applyView, addNeighbours, rerender, kick, fadeWorld]);

    // --- pan (no zoom) -------------------------------------------------

    useEffect(() => {
        const c = containerRef.current;
        if (!c) return;

        const pointers = new Map<number, { x: number; y: number }>();
        let lastX = 0;
        let lastY = 0;
        let lastT = 0;
        let moved = 0;

        const onDown = (e: PointerEvent) => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size !== 1) return;
            dragged.current = false;
            moved = 0;
            lastX = e.clientX;
            lastY = e.clientY;
            lastT = performance.now();
            vel.current.x = 0;
            vel.current.y = 0;
            c.style.cursor = "grabbing";
        };

        const onMove = (e: PointerEvent) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if ([...pointers.keys()][0] !== e.pointerId) return; // first finger only
            const now = performance.now();
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            if (dx === 0 && dy === 0) return;
            view.current.x += dx;
            view.current.y += dy;
            moved += Math.abs(dx) + Math.abs(dy);
            if (moved > DRAG_THRESHOLD) dragged.current = true;
            const dt = Math.max(1, now - lastT);
            vel.current.x = (dx / dt) * 16.667;
            vel.current.y = (dy / dt) * 16.667;
            lastX = e.clientX;
            lastY = e.clientY;
            lastT = now;
            applyView();
            maybeExpandFrontier();
        };

        const onUp = (e: PointerEvent) => {
            if (!pointers.delete(e.pointerId)) return;
            if (pointers.size > 0) return;
            c.style.cursor = "grab";
            if (
                dragged.current &&
                performance.now() - lastT < 90 &&
                Math.abs(vel.current.x) + Math.abs(vel.current.y) > 0.6
            ) {
                kick();
            }
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
            vel.current.x = 0;
            vel.current.y = 0;
            view.current.x -= e.deltaX * unit;
            view.current.y -= e.deltaY * unit;
            applyView();
            maybeExpandFrontier();
        };

        c.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        c.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            c.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            c.removeEventListener("wheel", onWheel);
        };
    }, [applyView, kick, maybeExpandFrontier]);

    const onNodeClick = (id: number) => {
        if (dragged.current) return;
        const n = nodes.current.get(id);
        if (!n || n.depth === 0) return;
        onPick(id);
    };

    const nodeList = [...nodes.current.values()];
    const edgeList = [...edges.current];

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 touch-none select-none overflow-hidden bg-paper"
            style={{ cursor: "grab" }}
        >
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        "radial-gradient(circle at 50% 40%, transparent 0%, color-mix(in srgb, var(--color-ink) 6%, transparent) 100%)",
                }}
            />

            <div
                ref={worldRef}
                className="absolute left-0 top-0 h-0 w-0"
                style={{ opacity: 0, transition: "opacity 220ms ease" }}
            >
                {edgeList.map((k) => (
                    <div
                        key={k}
                        ref={(el) => {
                            if (el) edgeEls.current.set(k, el);
                            else edgeEls.current.delete(k);
                        }}
                        className="pointer-events-none absolute left-0 top-0 origin-left"
                        style={{
                            height: 2,
                            width: 0,
                            marginTop: -1,
                            background:
                                "linear-gradient(90deg, transparent, var(--color-ink-soft))",
                        }}
                    />
                ))}

                {nodeList.map((n) => {
                    const isRoot = n.depth === 0;
                    const size = isRoot ? ROOT_NODE : NODE;
                    return (
                        <button
                            key={n.id}
                            type="button"
                            ref={(el) => {
                                if (el) nodeEls.current.set(n.id, el);
                                else nodeEls.current.delete(n.id);
                            }}
                            onClick={() => onNodeClick(n.id)}
                            title={n.title ?? undefined}
                            aria-label={
                                isRoot
                                    ? "Current image"
                                    : `Explore ${n.title ?? `image ${n.id}`}`
                            }
                            className={`group absolute left-0 top-0 block overflow-hidden rounded-2xl p-0 ${
                                isRoot
                                    ? "cursor-default ring-2 ring-yellow"
                                    : "cursor-pointer ring-1 ring-ink/15 hover:ring-ink/60"
                            }`}
                            style={{ width: size, height: size, opacity: 0 }}
                        >
                            {n.imageUrl || !isRoot ? (
                                <img
                                    src={blockImageSrc(n, isRoot ? 400 : 300)}
                                    alt={n.title ?? ""}
                                    draggable={false}
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => {
                                        const i = e.currentTarget;
                                        const f = `/i/${n.id}`;
                                        if (!i.src.endsWith(f)) i.src = f;
                                    }}
                                    className="h-full w-full object-cover transition group-hover:brightness-110"
                                />
                            ) : (
                                <div className="h-full w-full bg-rule" />
                            )}
                        </button>
                    );
                })}
            </div>

            {status === "loading" ? (
                <div className="absolute inset-0 grid place-items-center text-sm text-ink-soft">
                    finding connections…
                </div>
            ) : null}
            {status === "error" ? (
                <div className="absolute inset-0 grid place-items-center text-sm text-ink-soft">
                    no connections for this image.
                </div>
            ) : null}
        </div>
    );
}
