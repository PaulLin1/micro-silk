import { useCallback, useEffect, useRef, useState } from "react";
import { ExploreView } from "./ExploreView";

/**
 * Shared state for opening the similarity map in place of a grid — used by the
 * feed, search, and channel pages. The grid stays mounted (hidden) so its
 * scroll position survives a round trip.
 */
export function useExplore() {
    const [id, setId] = useState<number | null>(null);
    const scrollY = useRef(0);

    const open = useCallback((blockId: number) => {
        scrollY.current = window.scrollY;
        setId(blockId);
        window.scrollTo(0, 0);
    }, []);

    const close = useCallback(() => setId(null), []);

    useEffect(() => {
        if (id === null && scrollY.current > 0) {
            window.scrollTo(0, scrollY.current);
        }
    }, [id]);

    return { id, active: id !== null, open, close, select: setId };
}

export type ExploreControls = ReturnType<typeof useExplore>;

/** Renders the map over the current positioned ancestor when active. */
export function ExploreLayer({ explore }: { explore: ExploreControls }) {
    if (explore.id === null) return null;
    return (
        <ExploreView
            blockId={explore.id}
            onSelect={explore.select}
            onClose={explore.close}
        />
    );
}
