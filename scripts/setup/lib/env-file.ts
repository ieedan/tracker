/**
 * Reading and writing the project's `.env` files.
 *
 * One rendered file per mode, with the same comments the committed
 * `.env.example` carries, so a generated file still reads like a written one.
 */
import fs from "node:fs";
import path from "node:path";
import type { SetupMode } from "./types.ts";

export const ENV_FILE: Record<SetupMode, string> = {
	dev: ".env",
	preview: ".env.preview",
	prod: ".env.production",
};

/** Values that should never be printed back in full. */
export const SECRET_KEYS = new Set([
	"BETTER_AUTH_SECRET",
	"CRON_SECRET",
	"DATABASE_AUTH_TOKEN",
	"GITHUB_APP_PRIVATE_KEY",
	"GITHUB_APP_WEBHOOK_SECRET",
	"GITHUB_CLIENT_SECRET",
	"GITHUB_DEV_TOKEN",
	"S3_SECRET_ACCESS_KEY",
	"TURSO_API_TOKEN",
]);

/** Every key these files own, in the order they are written. */
export const KNOWN_KEYS = [
	"PUBLIC_APP_NAME",
	"DATABASE_URL",
	"DATABASE_AUTH_TOKEN",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
	"BETTER_AUTH_TRUSTED_ORIGINS",
	"CRON_SECRET",
	"S3_ENDPOINT",
	"S3_REGION",
	"S3_BUCKET",
	"S3_ACCESS_KEY_ID",
	"S3_SECRET_ACCESS_KEY",
	"S3_PUBLIC_ENDPOINT",
	"GITHUB_CLIENT_ID",
	"GITHUB_CLIENT_SECRET",
	"GITHUB_APP_ID",
	"GITHUB_APP_SLUG",
	"GITHUB_APP_PRIVATE_KEY",
	"GITHUB_APP_WEBHOOK_SECRET",
	"GITHUB_DEV_TOKEN",
	"GITHUB_API_URL",
	"TURSO_API_TOKEN",
	"TURSO_ORG",
	"TURSO_GROUP",
	"TURSO_PREVIEW_PARENT",
] as const;

/** Enough of a secret to recognise it, not enough to leak it over a shoulder. */
export function mask(value: string): string {
	// A private key arrives with real newlines in it, which would break whatever
	// this is printed inside.
	const flat = value.replaceAll(/\s+/g, " ").trim();
	if (flat === "") return "";
	if (flat.length <= 8) return "•".repeat(flat.length);
	return `${flat.slice(0, 4)}${"•".repeat(6)}${flat.slice(-4)}`;
}

/** How a value should appear in a summary: masked if secret, `(empty)` if blank. */
export function display(key: string, value: string): string {
	if (value === "") return "(empty)";
	return SECRET_KEYS.has(key) ? mask(value) : value;
}

/** Quote a value so spaces, `#`, and `\n` escapes survive a round trip. */
function encode(value: string): string {
	if (value === "") return "";
	const flattened = value.replaceAll(/\r?\n/g, "\\n");
	if (/[\s#"']/.test(flattened) || flattened.includes("\\")) {
		return `"${flattened.replaceAll('"', '\\"')}"`;
	}
	return flattened;
}

function line(key: string, values: Record<string, string>): string {
	return `${key}=${encode(values[key] ?? "")}`;
}

const HEADERS: Record<SetupMode, string> = {
	dev: "# Written by `setup dev`. Gitignored — the committed list is .env.example.",
	preview:
		"# Written by `setup preview`. Gitignored — these are pushed to Vercel's Preview\n# environment; each preview deployment branches its own database from them.",
	prod: "# Written by `setup prod`. Gitignored. Real credentials — do not commit.",
};

/**
 * The whole environment as a commented `.env` file.
 *
 * Anything already in the file that setup does not own is carried over, so a
 * hand-added value is never silently dropped by a re-run.
 */
export function render(
	mode: SetupMode,
	values: Record<string, string>,
	existing: Record<string, string>,
): string {
	const lines = [
		HEADERS[mode],
		"",
		line("PUBLIC_APP_NAME", values),
		"",
		mode === "dev"
			? "# libSQL. A local file in dev; a Turso URL (libsql://...) in production."
			: "# Turso (hosted libSQL).",
		line("DATABASE_URL", values),
		"# Only needed for a remote Turso database.",
		line("DATABASE_AUTH_TOKEN", values),
		"",
		"# Signs session cookies.",
		line("BETTER_AUTH_SECRET", values),
		mode === "preview"
			? "# A fallback only: preview builds set this to the deployment's own branch URL."
			: "# The origin the app is served from.",
		line("BETTER_AUTH_URL", values),
		"# Extra origins the auth routes accept. Preview builds fill this in with the",
		"# hosts the deployment answers on; blank everywhere else.",
		line("BETTER_AUTH_TRUSTED_ORIGINS", values),
		"",
		"# Authorises POST /api/v1/webhooks/drain, which retries failed webhook",
		"# deliveries. Blank closes that route.",
		line("CRON_SECRET", values),
		"",
		mode === "dev"
			? "# Object storage for attachments. `docker compose up -d` runs MinIO locally."
			: "# Object storage for attachments — Cloudflare R2, or anything S3-compatible.",
		line("S3_ENDPOINT", values),
		line("S3_REGION", values),
		line("S3_BUCKET", values),
		line("S3_ACCESS_KEY_ID", values),
		line("S3_SECRET_ACCESS_KEY", values),
		"# Only when the browser reaches storage at a different host than the server does.",
		line("S3_PUBLIC_ENDPOINT", values),
		"",
		"# --- GitHub -----------------------------------------------------------------",
		"# OAuth credentials: Sign in with GitHub. Blank hides the button.",
		line("GITHUB_CLIENT_ID", values),
		line("GITHUB_CLIENT_SECRET", values),
		"",
		"# The same App, for repository access. Blank leaves linking unavailable.",
		line("GITHUB_APP_ID", values),
		line("GITHUB_APP_SLUG", values),
		line("GITHUB_APP_PRIVATE_KEY", values),
		line("GITHUB_APP_WEBHOOK_SECRET", values),
		"",
		"# Development only. Ignored when GITHUB_APP_ID is set.",
		line("GITHUB_DEV_TOKEN", values),
		line("GITHUB_API_URL", values),
	];

	if (mode === "preview") {
		lines.push(
			"",
			"# --- preview databases -------------------------------------------------------",
			"# `scripts/preview-db.ts` reads these during a Vercel preview build and",
			"# branches TURSO_PREVIEW_PARENT into a database of that deployment's own.",
			line("TURSO_API_TOKEN", values),
			line("TURSO_ORG", values),
			line("TURSO_GROUP", values),
			line("TURSO_PREVIEW_PARENT", values),
		);
	}

	const known = new Set<string>(KNOWN_KEYS);
	const extras = Object.entries(existing).filter(([key]) => !known.has(key));
	if (extras.length > 0) {
		lines.push("", "# Kept from the existing file.", ...extras.map(([key]) => line(key, existing)));
	}

	return `${lines.join("\n")}\n`;
}

/** Writes 0600: these files hold a signing secret and a database token. */
export function write(cwd: string, mode: SetupMode, contents: string): string {
	const file = path.resolve(cwd, ENV_FILE[mode]);
	fs.writeFileSync(file, contents, { mode: 0o600 });
	return ENV_FILE[mode];
}
