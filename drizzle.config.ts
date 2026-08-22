import { defineConfig } from "drizzle-kit";

// drizzle-kit loads `.env` itself; the fallback keeps `generate` working without one.
export default defineConfig({
	dialect: "postgresql",
	schema: "./src/lib/server/db/schema.server.ts",
	out: "./drizzle",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://tracker:tracker@localhost:5432/tracker",
	},
	casing: "snake_case",
});
