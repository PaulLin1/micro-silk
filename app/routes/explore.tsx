import type { Route } from "./+types/explore";
import { exploreNeighbours, type Neighbourhood } from "~/explore.server";

type LoaderResult = Neighbourhood | { error: string };

// Resource route: no component. The explore web (app/explore/ExploreWeb.tsx)
// fetches one of these per node it expands. Errors are returned, not thrown, so
// a bad id can't take out the whole app via the root boundary.
export async function loader({
    params,
    request,
}: Route.LoaderArgs): Promise<LoaderResult> {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return { error: "Not found" };

    const n = Number(new URL(request.url).searchParams.get("n")) || 8;
    const result = await exploreNeighbours(id, n);
    if (!result) return { error: "This image has no similar-image data yet." };
    return result;
}
