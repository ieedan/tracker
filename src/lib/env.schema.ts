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
	// Two separate credentials, deliberately. The OAuth app signs people in and
	// asks for nothing but their identity. The GitHub App is what reaches
	// repositories, and it is installed per-organisation by someone who can say
	// yes to that — so signing in never implies handing over your code.
	/** OAuth app, for "Sign in with GitHub". Leave blank to hide the button. */
	GITHUB_CLIENT_ID: v.optional(v.string(), ""),
	GITHUB_CLIENT_SECRET: v.optional(v.string(), ""),
	/**
	 * GitHub App, for reading repositories. Leave blank and repository linking
	 * stays unavailable rather than half-working.
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
