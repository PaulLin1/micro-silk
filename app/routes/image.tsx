import type { Route } from "./+types/image";
import { getImageResponse } from "~/r2.server";

export async function loader({ params }: Route.LoaderArgs) {
    const id = params.id;
    if (!id || !/^\d+$/.test(id)) {
        throw new Response("Not found", { status: 404 });
    }
    return getImageResponse(`${id}.jpg`);
}
