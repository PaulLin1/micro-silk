import type { Route } from "./+types/channels";
import { Channels } from "../channels/Channels";
import { listChannels } from "~/channels.server";
import { SITE_NAME } from "~/site";

export function meta() {
    return [
        { title: `Channels — ${SITE_NAME}` },
        { name: "description", content: "Browse curated channels" },
    ];
}

export async function loader() {
    return { channels: await listChannels() };
}

export default function ChannelsRoute({ loaderData }: Route.ComponentProps) {
    return <Channels channels={loaderData.channels} />;
}
