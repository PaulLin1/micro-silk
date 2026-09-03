import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("i/:id", "routes/image.tsx"),
    route("search", "routes/search.tsx"),
    route("ambient", "routes/ambient.tsx"),
    route("explore/:id", "routes/explore.tsx"),
    route("channels", "routes/channels.tsx"),
    route("channels/:id", "routes/channel.tsx"),

] satisfies RouteConfig;
