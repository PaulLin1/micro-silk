import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { PostGrid, type Block } from "~/components/PostGrid";
import { FeedSettings, useFeedView } from "~/components/FeedSettings";
import { AmbientCollage } from "~/components/AmbientCollage";
import { ExploreLayer, useExplore } from "~/explore/useExplore";

export function Welcome({ initialBlocks, initialSeed }: { initialBlocks: Block[]; initialSeed: string }) {
    const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
    const fetcher = useFetcher<{ blocks: Block[] }>();
    const sentinelRef = useRef<HTMLDivElement>(null);
    const explore = useExplore();
    const [view, changeView] = useFeedView();

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

    // Load the next page once the sentinel at the bottom of the page scrolls
    // into view. The sentinel is display:none in ambient mode, so this parks
    // itself there.
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

    const ambient = view === "ambient" && !explore.active;

    return (
        <main
            className={
                explore.active
                    ? "relative h-[calc(100vh-3.5rem)] overflow-hidden"
                    : ambient
                      ? "fixed inset-x-0 bottom-0 top-14 flex flex-col px-5 sm:px-8"
                      : "relative px-5 pb-16 sm:px-8"
            }
        >
            {!explore.active && <FeedSettings view={view} onChange={changeView} />}

            {/* Header stays visible in both masonry and ambient — it's the
                clear space the floating FeedSettings switch sits over. */}
            {!explore.active && (
                <div
                    className={`bg-paper pb-3 pt-5 ${
                        ambient ? "shrink-0" : "sticky top-14 z-10"
                    }`}
                >
                    <h1 className="text-lg text-ink">Feed</h1>
                </div>
            )}

            {/* Masonry grid — kept mounted (hidden) in ambient mode so its
                infinite-scroll state and scroll position survive a toggle. */}
            <div className={explore.active || ambient ? "hidden" : ""}>
                <PostGrid blocks={blocks} onExplore={explore.open} />
                <div ref={sentinelRef} className="h-1 w-full" />
            </div>

            {ambient && (
                <div className="relative -mx-5 flex-1 sm:-mx-8">
                    <AmbientCollage onExit={() => changeView("masonry")} />
                </div>
            )}

            <ExploreLayer explore={explore} />
        </main>
    );
}
