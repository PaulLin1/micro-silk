"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "~/components/Sidebar";
import { PostGrid, type Block } from "~/components/PostGrid";

const topNavItems = [
    { name: "Feed", to: "/" },
    // { name: "Staff Picks", to: "/" },
    // { name: "Recent", to: "/recent" },
];

export function Feed({
    initialBlocks,
    initialSeed,
}: {
    initialBlocks: Block[];
    initialSeed: string;
}) {
    const pathname = usePathname();
    const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
    const sentinelRef = useRef<HTMLDivElement>(null);

    // Refs so the observer effect can read fresh values without being recreated
    // every fetch (IntersectionObserver re-fires on observe() if the target is
    // already visible, which can race a state update mid-flight).
    const offsetRef = useRef(initialBlocks.length);
    const loadingRef = useRef(false);
    const doneRef = useRef(false);

    const loadMore = useCallback(async () => {
        if (loadingRef.current || doneRef.current) return;
        loadingRef.current = true;
        try {
            const res = await fetch(
                `/api/blocks?offset=${offsetRef.current}&seed=${encodeURIComponent(initialSeed)}`,
            );
            if (!res.ok) return;
            const data = (await res.json()) as { blocks: Block[] };
            const next = data.blocks ?? [];
            if (next.length === 0) {
                doneRef.current = true;
                return;
            }
            setBlocks((prev) => [...prev, ...next]);
            offsetRef.current += next.length;
        } finally {
            loadingRef.current = false;
        }
    }, [initialSeed]);

    // Load the next page once the sentinel at the bottom scrolls into view.
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) loadMore();
            },
            { rootMargin: "1000px" },
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadMore]);

    return (
        <main className="flex flex-row min-h-screen">
            <Sidebar />

            {/* Main Content — scrolls with the natural page/document, no nested scroll pane */}
            <div className="flex-1 pl-5 pr-5">
                {/* Top Navbar */}
                <nav className="sticky h-20 top-0 z-10 flex flex-row justify-between items-center w-full bg-[#0b0b0c]">
                    <div className="flex gap-5">
                        {topNavItems.map((item) => {
                            const isActive =
                                item.to === "/" ? pathname === "/" : pathname === item.to;
                            return (
                                <Link
                                    key={item.name}
                                    href={item.to}
                                    className={`flex h-10 items-center justify-center rounded-full px-5 transition-colors duration-400 ${
                                        isActive
                                            ? "bg-[#1b1c1e] border border-[#303031] text-white"
                                            : "text-gray-500 hover:text-white"
                                    }`}
                                >
                                    <p>{item.name}</p>
                                </Link>
                            );
                        })}
                    </div>
                    <button>
                        <p className="text-white">Feed Settings</p>
                    </button>
                </nav>

                <PostGrid blocks={blocks} />

                {/* Sentinel: when this scrolls into view, load the next page */}
                <div ref={sentinelRef} className="h-1 w-full" />
            </div>
        </main>
    );
}
