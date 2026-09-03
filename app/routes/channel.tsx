import type { Route } from "./+types/channel";
import { Channel } from "../channels/Channel";
import { getChannel } from "~/channels.server";
import { SITE_NAME } from "~/site";

export function meta({ loaderData }: Route.MetaArgs) {
    return [
        {
            title: loaderData?.channel
                ? `${loaderData.channel.title} — ${SITE_NAME}`
                : `Channel — ${SITE_NAME}`,
        },
    ];
}

export async function loader({ params }: Route.LoaderArgs) {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Response("Not found", { status: 404 });
    }
    const channel = await getChannel(id);
    if (!channel) {
        throw new Response("Channel not found", { status: 404 });
    }
    return { channel };
}

export default function ChannelRoute({ loaderData }: Route.ComponentProps) {
    return <Channel channel={loaderData.channel} />;
}
