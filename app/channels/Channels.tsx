import { Link } from "react-router";
import { Sidebar } from "~/components/Sidebar";
import { arenaImage } from "~/arena-image";
import type { ChannelCard } from "~/channels.server";

export function Channels({ channels }: { channels: ChannelCard[] }) {
    return (
        <main className="flex min-h-screen flex-row">
            <Sidebar />

            <div className="flex-1 px-5 pb-16">
                <nav className="sticky top-0 z-10 flex h-20 items-center bg-[#0b0b0c]">
                    <h1 className="text-lg text-white">Channels</h1>
                    <span className="ml-3 text-sm text-gray-500">
                        {channels.length} collections
                    </span>
                </nav>

                <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]">
                    {channels.map((ch) => (
                        <ChannelCardView key={ch.id} channel={ch} />
                    ))}
                </div>
            </div>
        </main>
    );
}

function ChannelCardView({ channel }: { channel: ChannelCard }) {
    return (
        <Link
            to={`/channels/${channel.id}`}
            className="group flex flex-col overflow-hidden rounded-lg border border-[#232325] bg-[#131315] transition-colors hover:border-[#3b3b3f]"
        >
            <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px bg-[#232325]">
                {Array.from({ length: 4 }).map((_, i) => {
                    const b = channel.preview[i];
                    return b ? (
                        <img
                            key={i}
                            src={arenaImage(b.imageUrl, 260) ?? `/i/${b.id}`}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                        />
                    ) : (
                        <div key={i} className="bg-[#1b1b1d]" />
                    );
                })}
            </div>

            <div className="flex flex-1 flex-col p-3">
                <div className="flex items-baseline justify-between gap-2">
                    <h2 className="truncate text-sm font-medium text-white">
                        {channel.title}
                    </h2>
                    {channel.itemCount != null && (
                        <span className="shrink-0 text-[11px] text-gray-500">
                            {channel.itemCount.toLocaleString()}
                        </span>
                    )}
                </div>
                {channel.curator && (
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">
                        @{channel.curator}
                    </p>
                )}
                {channel.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-gray-400">
                        {channel.description}
                    </p>
                )}
            </div>
        </Link>
    );
}
