import { Form } from "react-router";
import { Sidebar } from "~/components/Sidebar";
import { PostGrid, type Block } from "~/components/PostGrid";

export function Search({ blocks, query }: { blocks: Block[]; query: string }) {
    return (
        <main className="flex flex-row min-h-screen">
            <Sidebar />

            <div className="flex-1 p-5 flex justify-center">
                {query && blocks.length === 0 ? (
                    <p className="text-center text-gray-500 py-10">
                        No results for "{query}"
                    </p>
                ) : (
                    <PostGrid blocks={blocks} />
                )}

                <div className="fixed bottom-6 left-[calc(50%+128px)] -translate-x-1/2 z-50">
                    <div className="w-200 h-30 rounded-4xl bg-[#181818]/95 backdrop-blur-xl p-5 flex flex-col shadow-2xl">
                        <Form method="get" className="flex-1">
                            <input
                                type="text"
                                name="q"
                                defaultValue={query}
                                placeholder="Search..."
                                className="w-full bg-transparent text-lg text-white placeholder:text-[#7b7b7b] focus:outline-none"
                            />
                        </Form>

                        <div className="flex items-end justify-between">
                            <div className="flex gap-2">
                                <button className="h-10 px-4 rounded-full bg-[#252525] flex items-center gap-2 text-white text-sm">
                                    <span>✿</span>
                                    <span className="text-xs text-gray-400">
                                        ⌄
                                    </span>
                                </button>

                                <button className="h-10 px-4 rounded-full bg-[#252525] flex items-center gap-2 text-white text-sm">
                                    <span>▦</span>
                                    <span className="text-xs text-gray-400">
                                        ⌄
                                    </span>
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                <button className="w-8 h-8 flex items-center justify-center text-lg text-gray-400">
                                    ⊞
                                </button>

                                <button className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-lg text-black">
                                    ⌕
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
