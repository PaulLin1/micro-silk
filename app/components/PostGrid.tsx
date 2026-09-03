import { useEffect, useMemo, useRef, useState } from "react";
import { blockImageSrc } from "~/arena-image";

// Matches the old `columns-[17rem] gap-x-4` (17rem = 272px, gap-x-4 = 16px).
const GRID_COLUMN_WIDTH = 272;
const GRID_GAP = 16;

export type Block = {
    id: number;
    title: string | null;
    posterName: string | null;
    imageUrl?: string | null;
};

export function PostGrid({
    blocks,
    onExplore,
}: {
    blocks: Block[];
    onExplore?: (id: number) => void;
}) {
    const gridRef = useRef<HTMLDivElement>(null);
    const [columnCount, setColumnCount] = useState(1);

    // Column count from the grid's width; blocks are assigned to columns by
    // `index % columnCount` below so each item's column is fixed forever and
    // appending more blocks never moves items already on screen.
    useEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;

        const updateColumnCount = () => {
            const width = grid.clientWidth;
            setColumnCount(Math.max(1, Math.floor((width + GRID_GAP) / (GRID_COLUMN_WIDTH + GRID_GAP))));
        };

        updateColumnCount();
        const observer = new ResizeObserver(updateColumnCount);
        observer.observe(grid);
        return () => observer.disconnect();
    }, []);

    const columns = useMemo(() => {
        const cols: Block[][] = Array.from({ length: columnCount }, () => []);
        blocks.forEach((block, i) => cols[i % columnCount].push(block));
        return cols;
    }, [blocks, columnCount]);

    return (
        <div ref={gridRef} className="flex flex-row gap-4">
            {columns.map((column, i) => (
                <div key={i} className="flex flex-1 min-w-0 flex-col gap-4">
                    {column.map((block) => (
                        <PostCard
                            key={block.id}
                            block={block}
                            onOpen={onExplore ? () => onExplore(block.id) : undefined}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

type PostCardProps = {
    block: Block;
    onOpen?: () => void;
};

export function PostCard({ block, onOpen }: PostCardProps) {
    const img = (
        <img
            src={blockImageSrc(block, 400)}
            alt={block.title ?? "untitled"}
            loading="lazy"
            decoding="async"
            className="w-full border-b border-rule object-contain"
            onError={(e) => {
                (e.currentTarget.closest("div") as HTMLElement).style.display = "none";
            }}
        />
    );

    return (
        <div className="h-auto w-full border border-rule bg-paper">
            {onOpen ? (
                <button
                    type="button"
                    onClick={onOpen}
                    className="block w-full cursor-pointer transition-opacity hover:opacity-80"
                    title="Explore visually similar images"
                >
                    {img}
                </button>
            ) : (
                img
            )}
            <p className="p-2 text-sm text-ink-soft">{block.posterName ?? "unknown"}</p>
        </div>
    );
}
