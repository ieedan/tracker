import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "@/lib/env.server";
import { db } from "./db.server";
import * as schema from "./schema.server";

/**
 * GitHub sign-in, only when it has been configured.
 *
 * The scopes are deliberately the smallest ones that identify a person. Reading
 * repositories is the GitHub *App*'s job — a separate credential, installed by
 * someone with authority over the organisation — so signing in with GitHub
 * never quietly grants this app access to anybody's code.
 */
function githubSignIn() {
	if (env.GITHUB_CLIENT_ID === "" || env.GITHUB_CLIENT_SECRET === "") return {};
	return {
		github: {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
			// No `scope` here on purpose: better-auth already asks for exactly
			// `read:user user:email`, and repeating it only sends each twice.
		},
	};
}

/** Whether the "Sign in with GitHub" button has anything behind it. */
export const githubSignInConfigured = (): boolean =>
	env.GITHUB_CLIENT_ID !== "" && env.GITHUB_CLIENT_SECRET !== "";

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
	socialProviders: githubSignIn(),
	plugins: [
		apiKey({
			defaultPrefix: "trk_",
			// `enableSessionForAPIKeys` stays off (its default). Keys are resolved
			// directly in `hooks.server.ts` instead — see api-key.server.ts for why.
		}),
	],
});

export type Auth = typeof auth;
