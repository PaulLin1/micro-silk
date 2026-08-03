import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// pg emits 'error' on idle clients that lose their connection (e.g. Neon
// dropping an idle connection); without a listener that's an unhandled
// 'error' event, which crashes the whole process.
pool.on('error', (err) => {
  console.error('unexpected error on idle postgres client', err);
});

export const db = drizzle(pool);