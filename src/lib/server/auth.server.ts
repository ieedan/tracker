import { apiKey } from "@better-auth/api-key";
import { oauthDeviceAuthorization, oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { AGENT_GRANTABLE_SCOPES, AGENT_SCOPES, OPENID_SCOPES } from "@/lib/domain/agents";
import { env } from "@/lib/env.server";
import { API_KEY_PREFIX } from "./api-key.server";
import { db } from "./db.server";
import * as schema from "./schema.server";

/**
 * GitHub sign-in, only when it has been configured.
 *
 * The scopes are deliberately the smallest ones that identify a person. Reading
 * repositories is the GitHub *App*'s job — a separate credential, installed by
 * someone with authority over the organization — so signing in with GitHub
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
	// `/token` belongs to the OAuth provider, not to better-auth's own handler.
	disabledPaths: ["/token"],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
		minPasswordLength: 8,
	},
	socialProviders: githubSignIn(),
	user: {
		additionalFields: {
			// "agent" rows are bot members created when a client is authorized into
			// a workspace. `input: false` keeps sign-up from ever setting it.
			type: { type: "string", defaultValue: "human", input: false, returned: true },
		},
	},
	plugins: [
		apiKey({
			defaultPrefix: API_KEY_PREFIX,
			// Matches CreateApiKeyBody — the plugin's own default is 32.
			maximumNameLength: 60,
			// `enableSessionForAPIKeys` stays off (its default). Keys are resolved
			// directly in `hooks.server.ts` instead — see api-key.server.ts for why.
		}),
		// Signs the access tokens the OAuth provider issues, and publishes the
		// JWKS that oauth.server.ts verifies them against in-process.
		jwt(),
		oauthProvider({
			loginPage: "/login",
			consentPage: "/consent",
			scopes: [...OPENID_SCOPES, ...AGENT_SCOPES],
			// Open registration (RFC 7591) is what MCP and CLI clients expect. It
			// is safe only because consent is never skipped: nothing here marks a
			// registered client trusted, so every grant passes a human first.
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			clientRegistrationDefaultScopes: ["issues:read"],
			// Admin-only scopes are withheld at registration. Agents are capped
			// below admin in guards.server.ts regardless — this just turns a
			// certain 403 into a clear error at the point of registration.
			clientRegistrationAllowedScopes: AGENT_GRANTABLE_SCOPES,
		}),
		// The OAuth-aware build of better-auth's `deviceAuthorization` plugin: it
		// registers the same /device/* endpoints but redeems a device code for an
		// OAuth access token rather than a first-party session, so an agent never
		// holds a browser session. Use it *instead of* `deviceAuthorization`.
		oauthDeviceAuthorization({
			verificationUri: "/device",
		}),
	],
});

export type Auth = typeof auth;
