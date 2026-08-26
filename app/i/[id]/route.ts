import { getImageResponse } from "~/lib/r2";

// Proxies are.na block images out of the R2 bucket. Keys are `{id}.jpg`.
// The response carries `Cache-Control: immutable`, so Vercel's CDN serves
// repeat hits without re-invoking this function.
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    if (!id || !/^\d+$/.test(id)) {
        return new Response("Not found", { status: 404 });
    }

    try {
        return await getImageResponse(`${id}.jpg`);
    } catch (err) {
        // getImageResponse throws a Response (404) for a missing object.
        if (err instanceof Response) return err;
        throw err;
    }
}
