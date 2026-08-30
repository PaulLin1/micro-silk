import { Link } from "react-router";
import { Sidebar } from "~/components/Sidebar";
import { PostGrid } from "~/components/PostGrid";
import { ExploreLayer, useExplore } from "~/explore/useExplore";
import type { ChannelDetail } from "~/channels.server";

export function Channel({ channel }: { channel: ChannelDetail }) {
    const explore = useExplore();

    return (
        <main className="flex min-h-screen flex-row">
            <Sidebar />

            <div
                className={`relative flex-1 ${
                    explore.active ? "h-screen overflow-hidden" : "px-5 pb-16"
                }`}
            >
                <div className={explore.active ? "hidden" : ""}>
                    <div className="sticky top-0 z-10 bg-[#0b0b0c] pb-3 pt-5">
                        <Link
                            to="/channels"
                            className="text-xs text-gray-500 transition-colors hover:text-white"
                        >
                            ← Channels
                        </Link>
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <h1 className="text-lg text-white">{channel.title}</h1>
                            {channel.curator && (
                                <span className="text-sm text-gray-500">
                                    @{channel.curator}
                                </span>
                            )}
                            {channel.itemCount != null && (
                                <span className="text-sm text-gray-600">
                                    {channel.itemCount.toLocaleString()} items
                                </span>
                            )}
                        </div>
                        {channel.description && (
                            <p className="mt-1.5 max-w-2xl text-sm text-gray-400">
                                {channel.description}
                            </p>
                        )}
                    </div>

                    {channel.blocks.length === 0 ? (
                        <p className="py-10 text-center text-gray-500">
                            No images in this channel.
                        </p>
                    ) : (
                        <PostGrid blocks={channel.blocks} onExplore={explore.open} />
                    )}
                </div>

                <ExploreLayer explore={explore} />
            </div>
        </main>
    );
}
