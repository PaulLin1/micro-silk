import { NavLink, useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "~/components/Sidebar";
import { PostGrid, type Block } from "~/components/PostGrid";
import { ExploreLayer, useExplore } from "~/explore/useExplore";

const topNavItems = [{ name: "Feed", to: "/" }];

export function Welcome({ initialBlocks, initialSeed }: { initialBlocks: Block[]; initialSeed: string }) {
    const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
    const fetcher = useFetcher<{ blocks: Block[] }>();
    const sentinelRef = useRef<HTMLDivElement>(null);
    const explore = useExplore();

    // Refs so the observer effect below can read fresh values without being
    // recreated every fetch (IntersectionObserver re-fires on observe() if the
    // target is already visible, which can race a state update mid-flight).
    const offsetRef = useRef(initialBlocks.length);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    // Append newly fetched blocks once the fetcher resolves
    useEffect(() => {
        if (fetcher.data?.blocks) {
            setBlocks((prev) => [...prev, ...fetcher.data!.blocks]);
            offsetRef.current += fetcher.data.blocks.length;
        }
    }, [fetcher.data]);

    // Load the next page once the sentinel at the bottom of the page scrolls into view.
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const isVisible = entries[0]?.isIntersecting;
                const currentFetcher = fetcherRef.current;
                if (isVisible && currentFetcher.state === "idle") {
                    // "index" disambiguates this index route ("/") from its parent layout
                    // route — without it fetcher.load() silently targets the loader-less
                    // parent and no-ops.
                    currentFetcher.load(`/?index&offset=${offsetRef.current}&seed=${initialSeed}`);
                }
            },
            { rootMargin: "1000px" }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [initialSeed]);

    return (
        <main className="flex flex-row min-h-screen">
            <Sidebar />

            {/* Content column. In feed mode it scrolls with the document; in
                explore mode it's a fixed-height stage for the map. */}
            <div
                className={`relative flex-1 ${
                    explore.active ? "h-screen overflow-hidden" : ""
                }`}
            >
                <div className={explore.active ? "hidden" : "px-5"}>
                    {/* Top Navbar */}
                    <nav className="sticky h-20 top-0 z-10 flex flex-row justify-between items-center w-full bg-[#0b0b0c]">
                        <div className="flex gap-5">
                            {topNavItems.map((item) => (
                                <NavLink
                                    key={item.name}
                                    to={item.to}
                                    end={item.to === "/"}
                                    className={({ isActive }) =>
                                        `flex h-10 items-center justify-center rounded-full px-5 transition-colors duration-400 ${
                                            isActive
                                                ? "bg-[#1b1c1e] border border-[#303031] text-white"
                                                : "text-gray-500 hover:text-white"
                                        }`
                                    }
                                >
                                    <p>{item.name}</p>
                                </NavLink>
                            ))}
                        </div>
                    </nav>

                    <PostGrid blocks={blocks} onExplore={explore.open} />

                    {/* Sentinel: when this scrolls into view, load the next page */}
                    <div ref={sentinelRef} className="h-1 w-full" />
                </div>

                <ExploreLayer explore={explore} />
            </div>
        </main>
    );
}
