import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Neon's HTTP driver: one fetch() per query, no pooled TCP connections to leak
// across serverless invocations (the reason the old pg.Pool needed an idle
// 'error' handler). We never use transactions or sessions, so HTTP is a clean
// fit. DATABASE_URL already points at the Neon pooler endpoint.
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql);
