import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
    return [
        { title: "Micro Silk" },
        { name: "description", content: "Recreation of Silk" },
    ];
}

export async function loader() {
    const res = await fetch("https://picsum.photos/v2/list?limit=100");
    const photos = (await res.json()) as {
        id: string;
        width: number;
        height: number;
    }[];
    return { photos };
}

export default function Home({ loaderData }: Route.ComponentProps) {
    return <Welcome photos={loaderData.photos} />;
}
