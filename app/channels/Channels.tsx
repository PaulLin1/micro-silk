import { Link } from "react-router";
import { arenaImage } from "~/arena-image";
import type { ChannelCard } from "~/channels.server";

// Rotating accent edge, matching the feed's PostCards (not yellow).
const CARD_ACCENTS = ["border-navy", "border-red", "border-cyan", "border-iris"];

export function Channels({ channels }: { channels: ChannelCard[] }) {
    return (
        <main className="px-5 pb-16 sm:px-8">
            <nav className="sticky top-14 z-10 flex h-16 items-center gap-3 bg-paper">
                <h1 className="text-lg text-ink">Channels</h1>
                <span className="text-sm text-ink-soft">
                    {channels.length} collections
                </span>
            </nav>

            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]">
                {channels.map((ch, i) => (
                    <ChannelCardView
                        key={ch.id}
                        channel={ch}
                        accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
                    />
                ))}
            </div>
        </main>
    );
}

function ChannelCardView({
    channel,
    accent,
}: {
    channel: ChannelCard;
    accent: string;
}) {
    return (
        <Link
            to={`/channels/${channel.id}`}
            className={`group flex flex-col overflow-hidden border-2 bg-paper transition-opacity hover:opacity-90 ${accent}`}
        >
            <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px bg-rule">
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
                        <div key={i} className="bg-paper" />
                    );
                })}
            </div>

            <div className="flex flex-1 flex-col p-3">
                <div className="flex items-baseline justify-between gap-2">
                    <h2 className="truncate text-sm font-medium text-ink">
                        {channel.title}
                    </h2>
                    {channel.itemCount != null && (
                        <span className="shrink-0 text-[11px] text-ink-soft">
                            {channel.itemCount.toLocaleString()}
                        </span>
                    )}
                </div>
                {channel.curator && (
                    <p className="mt-0.5 truncate text-[11px] text-ink-soft">
                        @{channel.curator}
                    </p>
                )}
                {channel.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-ink-soft">
                        {channel.description}
                    </p>
                )}
            </div>
        </Link>
    );
}
