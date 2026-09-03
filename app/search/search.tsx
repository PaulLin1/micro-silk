import { Form } from "react-router";
import { PostGrid, type Block } from "~/components/PostGrid";
import { ExploreLayer, useExplore } from "~/explore/useExplore";

export function Search({ blocks, query }: { blocks: Block[]; query: string }) {
    const explore = useExplore();

    return (
        <main
            className={`relative ${
                explore.active
                    ? "h-[calc(100vh-3.5rem)] overflow-hidden"
                    : "flex justify-center px-5 pt-6 pb-24 sm:px-8"
            }`}
        >
            {!explore.active && (
                <>
                    {query && blocks.length === 0 ? (
                        <p className="py-10 text-center text-ink-soft">
                            No results for "{query}"
                        </p>
                    ) : (
                        <PostGrid blocks={blocks} onExplore={explore.open} />
                    )}

                    <div className="fixed bottom-14 left-1/2 z-50 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2">
                        <Form
                            method="get"
                            className="flex items-center gap-3 border-2 border-ink bg-paper p-3"
                        >
                            <input
                                type="text"
                                name="q"
                                defaultValue={query}
                                placeholder="Search…"
                                className="flex-1 bg-transparent text-lg text-ink placeholder:text-ink-soft focus:outline-none"
                            />

                            <button
                                type="submit"
                                className="flex h-10 w-10 shrink-0 items-center justify-center bg-yellow text-lg text-black"
                            >
                                ⌕
                            </button>
                        </Form>
                    </div>
                </>
            )}

            <ExploreLayer explore={explore} />
        </main>
    );
}
