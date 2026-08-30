import type { Route } from "./+types/search";
import { Search } from "../search/search";
import { search } from "~/search.server";

export function meta({}: Route.MetaArgs) {
    return [
        { title: "Search — Micro Silk" },
        { name: "description", content: "Search Micro Silk" },
    ];
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (!query) {
        return { blocks: [], query };
    }

    const rows = await search(query);

    return { blocks: rows, query };
}

export default function SearchRoute({ loaderData }: Route.ComponentProps) {
    return <Search blocks={loaderData.blocks} query={loaderData.query} />;
}
