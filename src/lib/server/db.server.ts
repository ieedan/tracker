// The web (fetch-only) libSQL client, deliberately.
//
// `@libsql/client` and `drizzle-orm/libsql` resolve to the *node* build, whose
// module graph reaches `libsql` — a native addon loaded through a dynamic
// `require("@libsql/<platform>")`. Rollup cannot follow that, so the server
// bundle ships a stub that throws "Could not dynamically require
// @libsql/linux-x64-gnu" the moment the function cold-starts on Vercel. The
// `/web` entries speak the same HTTP protocol over `fetch` with no addon at
// all, and everything past the client — `drizzle-orm/libsql/web` included —
// is the same code the node entry uses.
//
// The one thing `/web` cannot do is open a `file:` database, which is what
// development uses, so that client is pulled in lazily: as a dynamic import it
// lands in its own chunk and is never evaluated when the URL is remote.
import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import { env } from "@/lib/env.server";
import * as schema from "./schema.server";

const config = {
	url: env.DATABASE_URL,
	authToken: env.DATABASE_AUTH_TOKEN === "" ? undefined : env.DATABASE_AUTH_TOKEN,
};

const client = env.DATABASE_URL.startsWith("file:")
	? (await import("@libsql/client")).createClient(config)
	: createClient(config);

export const db = drizzle(client, { schema });
