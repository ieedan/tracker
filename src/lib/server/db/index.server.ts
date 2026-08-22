import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env.server";
import * as schema from "./schema.server";

/**
 * One pool per process. Vite's dev server re-evaluates modules on change, so
 * the pool is stashed on `globalThis` to keep an HMR cycle from leaking
 * connections until Postgres runs out of them.
 */
const KEY = Symbol.for("tracker:pool");
const holder = globalThis as { [KEY]?: Pool };

export const pool = (holder[KEY] ??= new Pool({ connectionString: env.DATABASE_URL, max: 10 }));

export const db = drizzle(pool, { schema, casing: "snake_case" });

export { schema };
export type Db = typeof db;
