import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env as publicEnv } from "@/lib/env.public";
import { env } from "@/lib/env.server";
import { db, schema } from "./db/index.server";

/** Set when the GitHub OAuth App hasn't been configured yet — the login page says so. */
export const githubConfigured = env.GITHUB_CLIENT_ID !== "" && env.GITHUB_CLIENT_SECRET !== "";

/**
 * The demo account path. GitHub OAuth needs a registered app, which a fresh
 * clone has not got, so `DEV_LOGIN=true` enables email+password sign-in for the
 * seeded `demo@tracker.local` user and nothing else.
 */
export const devLoginEnabled = env.DEV_LOGIN === "true";

export const auth = betterAuth({
	appName: publicEnv.PUBLIC_APP_NAME,
	baseURL: publicEnv.PUBLIC_APP_URL,
	basePath: "/api/auth",
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: "pg", schema, usePlural: false }),
	user: {
		additionalFields: {
			// Mirrored off the GitHub profile so a lookup by login doesn't need a
			// round trip to GitHub.
			githubLogin: { type: "string", required: false, input: false },
		},
	},
	account: {
		accountLinking: { enabled: true },
	},
	emailAndPassword: { enabled: devLoginEnabled },
	socialProviders: githubConfigured
		? {
				github: {
					clientId: env.GITHUB_CLIENT_ID,
					clientSecret: env.GITHUB_CLIENT_SECRET,
					// `read:org` is what makes workspaces work — without it GitHub
					// reports no organizations at all. `repo` is for private repo names.
					scope: ["read:user", "user:email", "read:org", "repo"],
					mapProfileToUser: (profile) => ({ githubLogin: profile.login }),
				},
			}
		: {},
	plugins: [
		// Keys are minted and revoked through better-auth, but authenticating with
		// one is done by `hooks.server.ts` calling `verifyApiKey` directly — see
		// the comment there for why the mocked-session option is left off.
		apiKey({ defaultPrefix: "trk_" }),
	],
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
