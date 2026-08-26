"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Matches the old `columns-[17rem] gap-x-4` (17rem = 272px, gap-x-4 = 16px).
const GRID_COLUMN_WIDTH = 272;
const GRID_GAP = 16;

export type Block = {
    id: number;
    title: string | null;
    posterName: string | null;
};

export function PostGrid({ blocks }: { blocks: Block[] }) {
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
                            imageUrl={`/i/${block.id}`}
                            imageName={block.title ?? "untitled"}
                            posterName={block.posterName ?? "unknown"}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

type PostCardProps = {
    imageUrl: string;
    imageName: string;
    posterName: string;
};

export function PostCard({ imageUrl, imageName, posterName }: PostCardProps) {
    return (
        <div className="bg-neutral-800 w-full h-auto pl-1 pr-1 pt-1 border border-gray-700">
            <img
                src={imageUrl}
                alt={imageName}
                loading="lazy"
                className="object-contain border border-gray-700 w-full"
                onError={(e) => {
                    e.currentTarget.parentElement!.style.display = "none";
                }}
            />
            <p className="p-2 text-white">{posterName}</p>
        </div>
    );
}
