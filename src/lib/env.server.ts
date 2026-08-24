import { defineEnv } from "@implementjs/kit";
import * as v from "valibot";

export const env = defineEnv({
	/** libSQL connection string — `file:./local.db` in dev, `libsql://…` for Turso. */
	DATABASE_URL: v.string(),
	/** Only set for a remote Turso database. */
	DATABASE_AUTH_TOKEN: v.optional(v.string(), ""),
	BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(16)),
	BETTER_AUTH_URL: v.pipe(v.string(), v.url()),
});
