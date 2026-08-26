import { NextResponse } from "next/server";
import { getFeedBlocks } from "~/lib/blocks";

// Infinite-scroll pagination for the home feed. The client passes back the seed
// from the initial server render so the ordering stays consistent.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const rawOffset = Number(searchParams.get("offset"));
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const seed = searchParams.get("seed") ?? String(Date.now());

    const blocks = await getFeedBlocks({ offset, seed });

    return NextResponse.json({ blocks });
}
