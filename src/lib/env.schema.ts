// The shape of this app's environment, in one place.
//
// `env.public.ts` and `env.server.ts` hand these to kit's `defineEnv`, and
// `scripts/setup.ts` validates its prompts against the very same schemas — so
// the interactive setup cannot produce a `.env` the app would reject at build
// time. Importing an env file directly would not work for that: it validates
// against `process.env` the moment it is imported, which is precisely the
// situation setup exists to fix.
//
// This module holds schemas only. No values, and nothing secret.
import * as v from "valibot";

/** The connection strings `@libsql/client` understands. */
const LIBSQL_URL = /^(file:|libsql:\/\/|https?:\/\/|wss?:\/\/)/;

export const publicEnvSchema = {
	PUBLIC_APP_NAME: v.pipe(v.string(), v.minLength(1)),
};

export const serverEnvSchema = {
	/** libSQL connection string — `file:./local.db` in dev, `libsql://…` for Turso. */
	DATABASE_URL: v.pipe(
		v.string(),
		v.regex(LIBSQL_URL, "must start with file:, libsql://, https:// or wss://"),
	),
	/** Only set for a remote Turso database. */
	DATABASE_AUTH_TOKEN: v.optional(v.string(), ""),
	BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(16, "must be at least 16 characters")),
	BETTER_AUTH_URL: v.pipe(v.string(), v.url("must be an absolute URL")),
	/**
	 * Extra origins the auth routes accept, comma-separated, beyond
	 * `BETTER_AUTH_URL` — which better-auth trusts on its own.
	 *
	 * A Vercel preview answers on two hosts: the deployment URL, which is what
	 * Vercel links from the pull request, and the branch URL. Only one of them
	 * can be `BETTER_AUTH_URL`, and a sign-in POST from the other is rejected as
	 * "Invalid origin" — so `scripts/preview-db.ts` names both here. Empty
	 * everywhere else.
	 */
	BETTER_AUTH_TRUSTED_ORIGINS: v.optional(v.string(), ""),
	/**
	 * The account behind the one-click "Sign in as <name>" button on the login
	 * page — for previews, where every reviewer would otherwise type the same
	 * seeded credentials by hand.
	 *
	 * Both halves blank is the default and hides the button; the endpoint behind
	 * it answers 404 in the same case, so the feature is off unless somebody
	 * deliberately turned it on. `scripts/preview-db.ts` fills these in for a
	 * Vercel preview automatically, because a preview database is a copy of the
	 * template `setup:preview` seeded and the demo account is therefore known to
	 * be in it.
	 *
	 * Never set these on a deployment whose database holds real data: anyone who
	 * can open the login page can press the button and land in that account. Nor
	 * on the Vercel project for a preview's sake — the build writes them there
	 * and a value from the project would only name an account the freshly
	 * branched preview database does not have; `PREVIEW_DEMO_LOGIN_*` is the
	 * knob for that, and `scripts/preview-db.ts` says why.
	 */
	DEMO_LOGIN_EMAIL: v.optional(v.string(), ""),
	DEMO_LOGIN_PASSWORD: v.optional(v.string(), ""),
	/**
	 * Authorises the webhook drain endpoint that retries failed deliveries.
	 * Leave empty and the endpoint stays closed — the safe default, since an
	 * open drain lets anyone make the server fire outbound requests.
	 */
	CRON_SECRET: v.optional(v.string(), ""),

	// --- object storage (attachments) ---------------------------------------
	// MinIO in development, Cloudflare R2 in production. Same S3 API either way.
	/** `http://localhost:9000` for MinIO, `https://<account>.r2.cloudflarestorage.com` for R2. */
	S3_ENDPOINT: v.optional(v.string(), ""),
	/** R2 ignores the region but the SDK insists on one; `auto` is R2's convention. */
	S3_REGION: v.optional(v.string(), "auto"),
	S3_BUCKET: v.optional(v.string(), ""),
	S3_ACCESS_KEY_ID: v.optional(v.string(), ""),
	S3_SECRET_ACCESS_KEY: v.optional(v.string(), ""),
	/**
	 * The endpoint the *browser* should use, when it differs from the one the
	 * server uses — running the app inside compose makes storage `storage:9000`
	 * to the server and `localhost:9000` to the browser. Blank means they match.
	 */
	S3_PUBLIC_ENDPOINT: v.optional(v.string(), ""),

	// --- GitHub -------------------------------------------------------------
	// One GitHub App covers both halves of this block. Its OAuth credentials
	// sign people in; its App ID and private key mint the installation tokens
	// that read repositories. The two are still different grants: authorising
	// sign-in hands over an identity, while installing the App onto an
	// organization is a separate decision, made by someone with authority over
	// it, that names the repositories it covers.
	//
	// Either half can be left blank — blank credentials hide the sign-in button,
	// a blank App leaves repository linking unavailable rather than half-working.
	/**
	 * The App's OAuth credentials, for "Sign in with GitHub". Leave blank to
	 * hide the button.
	 *
	 * A GitHub App's client ID starts with `Iv23li`; an OAuth app's starts with
	 * `Ov23li`. Both work here, but each is only valid for the callback URLs
	 * registered against *that* app — mixing them up is what produces GitHub's
	 * "The redirect_uri is not associated with this application" page.
	 */
	GITHUB_CLIENT_ID: v.optional(v.string(), ""),
	GITHUB_CLIENT_SECRET: v.optional(v.string(), ""),
	/**
	 * The same App, identified the way the installation API wants it.
	 *
	 * The private key is the PEM GitHub hands you at creation. Newlines survive
	 * `.env` badly, so `\n` escapes are accepted and unescaped on read.
	 */
	GITHUB_APP_ID: v.optional(v.string(), ""),
	GITHUB_APP_PRIVATE_KEY: v.optional(v.string(), ""),
	/** The App's URL slug, used to build its installation link. */
	GITHUB_APP_SLUG: v.optional(v.string(), ""),
	/** Signs the webhooks GitHub sends back. Blank refuses every delivery. */
	GITHUB_APP_WEBHOOK_SECRET: v.optional(v.string(), ""),
	/**
	 * A personal access token used *instead of* an App installation.
	 *
	 * Only for development, where creating and installing a real App to try the
	 * feature is a poor trade. Ignored whenever an App is configured.
	 */
	GITHUB_DEV_TOKEN: v.optional(v.string(), ""),
	/**
	 * The API root. Point this at `https://<host>/api/v3` for GitHub Enterprise
	 * Server; the default is github.com.
	 */
	GITHUB_API_URL: v.optional(v.string(), "https://api.github.com"),
};
