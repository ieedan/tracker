import { drizzle } from "drizzle-orm/libsql";
import { env } from "@/lib/env.server";
import * as schema from "./db/schema";
import { relations } from "./db/relations";

export const db = drizzle(env.DB_FILE_NAME, { relations });
