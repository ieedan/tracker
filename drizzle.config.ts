import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside vite, so it reads the environment directly rather
// than going through `src/lib/env.server.ts`.
const url = process.env.DATABASE_URL ?? "file:./local.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default defineConfig({
	schema: "./src/lib/server/schema.server.ts",
	out: "./drizzle",
	dialect: "turso",
	dbCredentials: {
		url,
		authToken: authToken === "" ? undefined : authToken,
	},
});
