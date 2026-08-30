import { Form } from "react-router";
import { Sidebar } from "~/components/Sidebar";
import { PostGrid, type Block } from "~/components/PostGrid";
import { ExploreLayer, useExplore } from "~/explore/useExplore";

export function Search({ blocks, query }: { blocks: Block[]; query: string }) {
    const explore = useExplore();

    return (
        <main className="flex flex-row min-h-screen">
            <Sidebar />

            <div
                className={`relative flex-1 ${
                    explore.active ? "h-screen overflow-hidden" : "p-5 flex justify-center"
                }`}
            >
                {!explore.active && (
                    <>
                        {query && blocks.length === 0 ? (
                            <p className="text-center text-gray-500 py-10">
                                No results for "{query}"
                            </p>
                        ) : (
                            <PostGrid blocks={blocks} onExplore={explore.open} />
                        )}

                        <div className="fixed bottom-6 left-[calc(50%+128px)] -translate-x-1/2 z-50">
                            <Form method="get" className="w-200 rounded-4xl bg-[#181818]/95 backdrop-blur-xl p-4 flex items-center gap-3 shadow-2xl">
                                <input
                                    type="text"
                                    name="q"
                                    defaultValue={query}
                                    placeholder="Search..."
                                    className="flex-1 bg-transparent text-lg text-white placeholder:text-[#7b7b7b] focus:outline-none"
                                />

                                <button type="submit" className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-lg text-black shrink-0">
                                    ⌕
                                </button>
                            </Form>
                        </div>
                    </>
                )}

                <ExploreLayer explore={explore} />
            </div>
        </main>
    );
}
