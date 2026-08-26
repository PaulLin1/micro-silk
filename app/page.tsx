import { getFeedBlocks } from "~/lib/blocks";
import { Feed } from "~/components/Feed";

// The feed is a fresh random sample per visit — never statically cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
    // Reuse this seed across the session's paginated /api/blocks calls so the
    // "random" md5(id || seed) order stays stable.
    const seed = String(Date.now());
    const blocks = await getFeedBlocks({ offset: 0, seed });

    return <Feed initialBlocks={blocks} initialSeed={seed} />;
}
