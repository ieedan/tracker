import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OAuth2Tokens, OAuth2UserInfo } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins";
import type { GithubProfile } from "better-auth/social-providers";
import {
	AGENT_GRANTABLE_SCOPES,
	AGENT_REGISTRABLE_SCOPES,
	AGENT_SCOPES,
	OPENID_SCOPES,
} from "@/lib/domain/agents";
import { env } from "@/lib/env.server";
import { API_KEY_PREFIX } from "./api-key.server";
import { db } from "./db.server";
import * as schema from "./schema.server";

/** One entry of `GET /user/emails`. */
interface GithubEmail {
	email: string;
	primary: boolean;
	verified: boolean;
}

/**
 * The two requests that identify whoever just signed in.
 *
 * This is what better-auth's stock GitHub provider already does, restated here
 * for one reason: to fail loudly when `GET /user/emails` is refused. A GitHub
 * App reads that endpoint through the *account* permission "Email addresses",
 * which is separate from the repository permissions and is not granted
 * retroactively — add it and everyone who authorised the App beforehand has to
 * approve it again. The stock provider ignores that request's error, so a 403
 * arrives as a user with no address and a NOT NULL violation several layers
 * further down, which reads as a database bug rather than a missing checkbox.
 *
 * The host is github.com's rather than `GITHUB_API_URL`, because better-auth
 * hardcodes github.com for the authorization and token endpoints: the access
 * token this is handed is always a github.com one, whatever that variable says.
 */
async function githubUserInfo(
	token: OAuth2Tokens,
): Promise<{ user: OAuth2UserInfo; data: GithubProfile } | null> {
	const get = (path: string) =>
		fetch(`https://api.github.com${path}`, {
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token.accessToken}`,
				"user-agent": "tracker",
			},
		});

	const profileResponse = await get("/user");
	if (!profileResponse.ok) {
		console.error(`GitHub sign-in: GET /user was refused (${profileResponse.status}).`);
		return null;
	}
	const profile = (await profileResponse.json()) as GithubProfile;

	const emailsResponse = await get("/user/emails");
	if (!emailsResponse.ok) {
		console.error(
			`GitHub sign-in: GET /user/emails was refused (${emailsResponse.status}). ` +
				'A GitHub App needs the account permission "Email addresses: read-only", ' +
				"and anyone who authorised it before that was added has to approve it again.",
		);
		return null;
	}
	const emails = (await emailsResponse.json()) as GithubEmail[];

	// `/user` only carries an address when the account made one public, so the
	// primary address from `/user/emails` is the usual source.
	profile.email = profile.email || ((emails.find((e) => e.primary) ?? emails[0])?.email ?? null);
	if (profile.email === null) {
		console.error("GitHub sign-in: GitHub returned no address for this account.");
		return null;
	}

	// Account linking treats this as the proof that the address is theirs, so it
	// has to come from GitHub rather than be assumed. See `accountLinking` below.
	const emailVerified = emails.find((e) => e.email === profile.email)?.verified ?? false;

	return {
		user: {
			name: profile.name || profile.login,
			email: profile.email,
			image: profile.avatar_url,
			emailVerified,
		},
		data: profile,
	};
}

/**
 * GitHub sign-in, only when it has been configured.
 *
 * These are the *GitHub App's* OAuth credentials — the same App that reaches
 * repositories through `GITHUB_APP_*`. A GitHub App runs the same
 * user-to-server flow at the same endpoints an OAuth app does, so better-auth's
 * stock `github` provider drives it unchanged; the App just has to list
 * `<origin>/api/auth/callback/github` among its callback URLs and hold the
 * "Email addresses" account permission.
 *
 * Signing in still grants nothing over anybody's code. Repository access comes
 * from an *installation* token minted against the App's private key (see
 * `providers/github.server.ts`), and installing the App onto an organization is
 * a separate decision made by someone with authority over it. Authorising
 * sign-in does not install anything.
 *
 * An OAuth app's credentials still work here unchanged, if you would rather
 * keep the two separate.
 */
function githubSignIn() {
	if (env.GITHUB_CLIENT_ID === "" || env.GITHUB_CLIENT_SECRET === "") return {};
	return {
		github: {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
			// No `scope` here on purpose. better-auth already asks for exactly
			// `read:user user:email`, and repeating it only sends each twice. A
			// GitHub App ignores the parameter outright and goes by its own
			// permissions instead, which is why "Email addresses" is load-bearing.
			getUserInfo: githubUserInfo,
		},
	};
}

/** Whether the "Sign in with GitHub" button has anything behind it. */
export const githubSignInConfigured = (): boolean =>
	env.GITHUB_CLIENT_ID !== "" && env.GITHUB_CLIENT_SECRET !== "";

/**
 * The canonical URI of the MCP server, as RFC 8707 defines it.
 *
 * MCP clients MUST send this as the `resource` parameter on both the
 * authorization and token requests, and the provider rejects a `resource` it
 * does not know with `invalid_target` — so the endpoint has to be registered
 * here, and this string has to match what `/.well-known/oauth-protected-resource`
 * advertises exactly. No trailing slash, per the spec's canonical form.
 */
export const MCP_RESOURCE = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/mcp`;

/**
 * The `iss` on every token this app issues, and what a verifier must be told to
 * expect. Leaving it out makes verification fail as a flat "invalid access
 * token", which looks like a bad token rather than a missing option.
 */
export const OAUTH_ISSUER = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/auth`;

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
	account: {
		accountLinking: {
			// Someone who signed up with a password and later clicks "Sign in with
			// GitHub" must land in their existing account, not a second one. The
			// default gate blocks that here forever: linking normally demands the
			// local row already have `emailVerified`, and with no verification mail
			// configured (see `emailAndPassword` above) no local row ever will.
			//
			// Turning the gate off makes GitHub's own `email_verified` claim the
			// proof of ownership instead. The accepted risk is pre-registration: an
			// attacker who creates a password account at your address *before* your
			// first GitHub sign-in captures the linked account, because they still
			// know that password. Closing that needs real email verification on
			// sign-up — do it before this app is open to untrusted sign-ups.
			//
			// TODO: better-auth deprecated this flag; the gate becomes unconditional
			// in 1.8, so email verification has to land before that upgrade.
			requireLocalEmailVerified: false,
		},
	},
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
			//
			// Those clients omit `application_type` and send a custom-scheme
			// redirect (Cursor: `cursor://anysphere.cursor-mcp/oauth/callback`).
			// Stock @better-auth/oauth-provider defaults them to "web" and rejects
			// the URI; we patch it so DCR is native and schemes with a host pass.
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			// A client that asks for nothing in particular gets the whole non-admin
			// set, because the tools are not independently useful: creating an
			// issue needs a team key, and finding one needs `workspace:read`. The
			// human still sees exactly what is being granted on the consent screen,
			// and admin scopes are excluded here regardless.
			clientRegistrationDefaultScopes: AGENT_GRANTABLE_SCOPES,
			// Admin-only scopes are withheld at registration. Agents are capped
			// below admin in guards.server.ts regardless — this just turns a
			// certain 403 into a clear error at the point of registration.
			clientRegistrationAllowedScopes: AGENT_REGISTRABLE_SCOPES,
			// Registering the MCP endpoint binds its tokens to it as an audience,
			// which is what lets the server reject a token minted for anything else.
			resources: [
				{
					identifier: MCP_RESOURCE,
					allowedScopes: AGENT_REGISTRABLE_SCOPES,
				},
			],
			// An MCP client registers with plain RFC 7591 metadata and has no way to
			// ask to be linked to our resource, but the provider rejects a `resource`
			// its client is not linked to. Linking every registration to the MCP
			// endpoint is what makes an out-of-the-box client work at all.
			clientRegistrationDefaultResources: [MCP_RESOURCE],
			clientRegistrationAllowedResources: [MCP_RESOURCE],
			/**
			 * A year, against a 30-day default.
			 *
			 * Refresh tokens rotate on every use and each rotation starts the clock
			 * again, so an agent that runs even occasionally never has to be
			 * authorized twice — this window only governs how long an *idle* one
			 * stays valid. Thirty days is short enough that a paused project means
			 * setting every agent up again; a year matches the promise that a grant
			 * lasts until someone revokes it in Settings.
			 */
			refreshTokenExpiresIn: 365 * 24 * 60 * 60,
		}),
	],
});

export type Auth = typeof auth;
