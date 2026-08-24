import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "@/lib/env.server";
import { db } from "./db.server";
import * as schema from "./schema.server";

export const auth = betterAuth({
	appName: "tracker",
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	basePath: "/api/auth",
	database: drizzleAdapter(db, { provider: "sqlite", schema }),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
		minPasswordLength: 8,
	},
	plugins: [
		apiKey({
			defaultPrefix: "trk_",
			// `enableSessionForAPIKeys` stays off (its default). Keys are resolved
			// directly in `hooks.server.ts` instead — see api-key.server.ts for why.
		}),
	],
});

export type Auth = typeof auth;
