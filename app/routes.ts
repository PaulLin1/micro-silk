import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("i/:id", "routes/image.tsx"),
    route("search", "routes/search.tsx"),
] satisfies RouteConfig;
