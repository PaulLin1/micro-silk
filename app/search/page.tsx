import type { Metadata } from "next";
import { SearchView } from "~/components/SearchView";
import { magicSearch } from "~/lib/search";

export const metadata: Metadata = {
    title: "Search — Micro Silk",
    description: "Search Micro Silk",
};

export const dynamic = "force-dynamic";
// Cold start = load the ONNX CLIP text encoder + first inference (~10-25s on
// Vercel's smaller CPUs) then a pgvector scan. 60s is the Hobby-plan ceiling.
export const maxDuration = 60;

export default async function SearchPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    const query = q?.trim() ?? "";

    const blocks = query ? await magicSearch(query) : [];

    return <SearchView blocks={blocks} query={query} />;
}
