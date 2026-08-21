import { drizzle } from "drizzle-orm/libsql";
import { env } from "@/lib/env.server";
import * as schema from "./db/schema";

export const db = drizzle({
	connection: { url: env.DATABASE_URL },
	schema,
});

export * from "./db/schema";
