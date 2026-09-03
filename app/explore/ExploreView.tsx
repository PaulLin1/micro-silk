import { useEffect, useRef } from "react";
import { ExploreWeb } from "./ExploreWeb";

/**
 * The similarity web, rendered in place of a grid (same page, no navigation).
 * Fills its nearest positioned ancestor — the caller gives that ancestor a
 * fixed height and `position: relative`.
 */
export function ExploreView({
    blockId,
    onSelect,
    onClose,
}: {
    blockId: number;
    onSelect: (id: number) => void;
    onClose: () => void;
}) {
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCloseRef.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <div className="absolute inset-0 overflow-hidden [animation:explore-in_160ms_ease-out]">
            <ExploreWeb rootId={blockId} onPick={onSelect} />

            <button
                type="button"
                onClick={onClose}
                className="absolute left-4 top-4 z-40 flex h-9 items-center gap-1.5 border-2 border-ink bg-paper px-3 text-sm text-ink transition-opacity hover:opacity-70"
            >
                <span aria-hidden>←</span> Feed
            </button>

            {/* Cleared above the fixed footer (Footer.tsx), not tight to the
                container edge like the old bottom-4. */}
            <div className="pointer-events-none absolute bottom-14 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap border border-ink bg-paper px-4 py-1.5 text-[11px] text-ink-soft">
                drag to roam the web · click an image to jump to it · esc
            </div>
        </div>
    );
}
