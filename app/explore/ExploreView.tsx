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
                className="absolute left-4 top-4 z-20 flex h-9 items-center gap-1.5 rounded-lg bg-[#181818]/85 pl-2 pr-3 text-sm text-white backdrop-blur-md transition-colors hover:bg-[#252525]"
            >
                <span aria-hidden>←</span> Feed
            </button>

            <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#181818]/70 px-4 py-1.5 text-[11px] text-gray-400 backdrop-blur-md">
                drag to roam the web · click an image to jump to it · esc
            </div>
        </div>
    );
}
