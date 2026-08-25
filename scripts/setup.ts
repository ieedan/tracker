/**
 * Interactive setup, for both environments.
 *
 *   pnpm setup:dev            this machine — writes .env
 *   pnpm setup:dev --yes      accept every default, no prompts (CI, containers)
 *   pnpm setup:prod           a real deployment — writes .env.production
 *   pnpm setup:prod --all     revisit answers that are already set
 *
 * Answers are validated against `src/lib/env.schema.ts` — the same schemas
 * `defineEnv` enforces at build time — so a file written here cannot be one
 * the app then refuses to start with.
 *
 * Both commands are safe to run again: anything already configured is skipped
 * (`prod`) or offered back as the default (`dev`).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import * as v from "valibot";
import { publicEnvSchema, serverEnvSchema } from "../src/lib/env.schema";

type Mode = "dev" | "prod";

const ARGS = process.argv.slice(2);
const FLAGS = new Set(ARGS.filter((arg) => arg.startsWith("-")));
const ACCEPT_DEFAULTS = FLAGS.has("--yes") || FLAGS.has("-y");
/** `prod` skips whatever is already set; `--all` walks every step regardless. */
const REVISIT_ALL = FLAGS.has("--all");

const ENV_FILE: Record<Mode, string> = { dev: ".env", prod: ".env.production" };

function parseMode(): Mode {
	const positional = ARGS.find((arg) => !arg.startsWith("-"));
	if (positional === undefined || positional === "dev") return "dev";
	if (positional === "prod" || positional === "production") return "prod";

	console.error(`Unknown command "${positional}". Expected \`dev\` or \`prod\`.`);
	process.exit(1);
}

const MODE = parseMode();
const ENV_PATH = resolve(process.cwd(), ENV_FILE[MODE]);

const SECRET_KEYS = new Set([
	"BETTER_AUTH_SECRET",
	"DATABASE_AUTH_TOKEN",
	"CRON_SECRET",
	"GITHUB_CLIENT_SECRET",
	"GITHUB_APP_PRIVATE_KEY",
	"GITHUB_APP_WEBHOOK_SECRET",
	"GITHUB_DEV_TOKEN",
	"S3_SECRET_ACCESS_KEY",
]);

const ESC = "\u001b[";
const style = (code: string) => (text: string) => `${ESC}${code}m${text}${ESC}0m`;
const bold = style("1");
const dim = style("2");
const red = style("31");
const green = style("32");
const yellow = style("33");
const cyan = style("36");

/** Parses an existing .env well enough to reuse its values as defaults. */
function readExisting(): Record<string, string> {
	if (!existsSync(ENV_PATH)) return {};

	const values: Record<string, string> = {};
	for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;

		const at = trimmed.indexOf("=");
		if (at === -1) continue;

		const key = trimmed.slice(0, at).trim();
		let value = trimmed.slice(at + 1).trim();
		const quoted =
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"));
		if (quoted && value.length >= 2) value = value.slice(1, -1);

		values[key] = value;
	}
	return values;
}

/** Enough of a secret to recognise it, not enough to leak it over someone's shoulder. */
function mask(value: string): string {
	if (value.length <= 8) return "•".repeat(value.length);
	return `${value.slice(0, 4)}${"•".repeat(6)}${value.slice(-4)}`;
}

/** The first thing the schema objects to, or `null` when it is happy. */
function check(schema: v.GenericSchema, value: unknown): string | null {
	const result = v.safeParse(schema, value);
	if (result.success) return null;
	return result.issues[0]?.message ?? "invalid value";
}

interface AskOptions {
	key: string;
	blurb: string;
	schema: v.GenericSchema;
	fallback: string;
	/** Show the default masked rather than in full. */
	secret?: boolean;
	/** Where the default came from — "current", "generated". */
	origin?: string;
}

async function ask(rl: Interface, options: AskOptions): Promise<string> {
	const { key, blurb, schema, fallback, secret = false, origin } = options;
	const shown = fallback === "" ? "" : secret ? mask(fallback) : fallback;

	console.log(`\n${bold(key)}  ${dim(blurb)}`);

	if (ACCEPT_DEFAULTS) {
		const problem = check(schema, fallback);
		if (problem !== null) {
			throw new Error(`--yes cannot answer ${key}: its default is not valid (${problem}).`);
		}
		console.log(`  ${dim("using")} ${shown === "" ? dim("(empty)") : shown}`);
		return fallback;
	}

	for (;;) {
		const label = origin === undefined ? shown : `${shown} — ${origin}`;
		const suffix = shown === "" ? "" : ` ${dim(`[${label}]`)}`;
		const answer = (await rl.question(`  ${cyan("›")}${suffix} `)).trim();
		const value = answer === "" ? fallback : answer;

		const problem = check(schema, value);
		if (problem === null) return value;
		console.log(`  ${red("✗")} ${problem}`);
	}
}

async function confirm(rl: Interface, question: string, fallback: boolean): Promise<boolean> {
	if (ACCEPT_DEFAULTS) return fallback;

	const hint = fallback ? "Y/n" : "y/N";
	for (;;) {
		const answer = (await rl.question(`${question} ${dim(`[${hint}]`)} `)).trim().toLowerCase();
		if (answer === "") return fallback;
		if (answer === "y" || answer === "yes") return true;
		if (answer === "n" || answer === "no") return false;
	}
}

async function choose(
	rl: Interface,
	question: string,
	options: Array<{ label: string; hint: string }>,
	fallback: number,
): Promise<number> {
	console.log(`\n${bold(question)}`);
	for (const [index, option] of options.entries()) {
		console.log(`  ${index + 1}) ${option.label}  ${dim(option.hint)}`);
	}
	if (ACCEPT_DEFAULTS) return fallback;

	for (;;) {
		const answer = (await rl.question(`  ${cyan("›")} ${dim(`[${fallback + 1}]`)} `)).trim();
		if (answer === "") return fallback;

		const picked = Number(answer);
		if (Number.isInteger(picked) && picked >= 1 && picked <= options.length) return picked - 1;
	}
}

function filled(value: string | undefined): boolean {
	return value !== undefined && value !== "";
}

function originOf(url: string): string {
	return url.replace(/\/+$/, "");
}

/** Quote a .env value so spaces, `#`, and `\n` escapes survive a round trip. */
function envEncode(value: string): string {
	if (value === "") return "";
	const flattened = value.replace(/\r?\n/g, "\\n");
	if (/[\s#"']/.test(flattened) || flattened.includes("\\")) {
		return `"${flattened.replace(/"/g, '\\"')}"`;
	}
	return flattened;
}

function envLine(key: string, value: string | undefined): string {
	return `${key}=${envEncode(value ?? "")}`;
}

/** Every key this file owns, in the order it writes them. */
const KNOWN_KEYS = [
	"PUBLIC_APP_NAME",
	"DATABASE_URL",
	"DATABASE_AUTH_TOKEN",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
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
] as const;

/**
 * The whole environment as a commented `.env` file.
 *
 * Anything already in the file that this script does not own is carried over,
 * so a hand-added value is never silently dropped by a re-run.
 */
function renderEnvFile(
	all: Record<string, string>,
	existing: Record<string, string>,
	header: string,
): string {
	const lines = [
		header,
		"",
		envLine("PUBLIC_APP_NAME", all.PUBLIC_APP_NAME),
		"",
		"# libSQL. A local file in dev; a Turso URL (libsql://...) in production.",
		envLine("DATABASE_URL", all.DATABASE_URL),
		"# Only needed for a remote Turso database.",
		envLine("DATABASE_AUTH_TOKEN", all.DATABASE_AUTH_TOKEN),
		"",
		"# Signs session cookies.",
		envLine("BETTER_AUTH_SECRET", all.BETTER_AUTH_SECRET),
		envLine("BETTER_AUTH_URL", all.BETTER_AUTH_URL),
		"",
		"# Authorises POST /api/v1/webhooks/drain, which retries failed webhook",
		"# deliveries. Blank closes that route.",
		envLine("CRON_SECRET", all.CRON_SECRET),
		"",
		MODE === "prod"
			? "# Object storage for attachments — Cloudflare R2, or anything S3-compatible."
			: "# Object storage for attachments. `docker compose up -d` runs MinIO locally.",
		envLine("S3_ENDPOINT", all.S3_ENDPOINT),
		envLine("S3_REGION", all.S3_REGION),
		envLine("S3_BUCKET", all.S3_BUCKET),
		envLine("S3_ACCESS_KEY_ID", all.S3_ACCESS_KEY_ID),
		envLine("S3_SECRET_ACCESS_KEY", all.S3_SECRET_ACCESS_KEY),
		"# Only when the browser reaches storage at a different host than the server does.",
		envLine("S3_PUBLIC_ENDPOINT", all.S3_PUBLIC_ENDPOINT),
		"",
		"# --- GitHub -----------------------------------------------------------------",
		"# OAuth app: Sign in with GitHub. Blank hides the button.",
		envLine("GITHUB_CLIENT_ID", all.GITHUB_CLIENT_ID),
		envLine("GITHUB_CLIENT_SECRET", all.GITHUB_CLIENT_SECRET),
		"",
		"# GitHub App: repository access. Blank leaves linking unavailable.",
		envLine("GITHUB_APP_ID", all.GITHUB_APP_ID),
		envLine("GITHUB_APP_SLUG", all.GITHUB_APP_SLUG),
		envLine("GITHUB_APP_PRIVATE_KEY", all.GITHUB_APP_PRIVATE_KEY),
		envLine("GITHUB_APP_WEBHOOK_SECRET", all.GITHUB_APP_WEBHOOK_SECRET),
		"",
		"# Development only. Ignored when GITHUB_APP_ID is set.",
		envLine("GITHUB_DEV_TOKEN", all.GITHUB_DEV_TOKEN),
		envLine("GITHUB_API_URL", all.GITHUB_API_URL),
		"",
	];

	const known = new Set<string>(KNOWN_KEYS);
	const extras = Object.entries(existing).filter(([key]) => !known.has(key));
	if (extras.length > 0) {
		lines.push(
			"# Kept from the existing file.",
			...extras.map(([key, value]) => envLine(key, value)),
			"",
		);
	}

	return lines.join("\n");
}

/** Writes 0600: the file holds a signing secret and probably a database token. */
function writeEnvFile(contents: string): void {
	writeFileSync(ENV_PATH, contents, { mode: 0o600 });
}

function looksLikePemPath(input: string): boolean {
	if (input.endsWith(".pem") || input.endsWith(".key")) return true;
	const path = resolve(process.cwd(), input);
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

function flattenPem(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\n/g, "\\n").trim();
}

function checkPem(value: string): string | null {
	if (value === "") return "a GitHub App needs a private key";
	const expanded = value.replace(/\\n/g, "\n");
	if (!expanded.includes("BEGIN") || !expanded.includes("PRIVATE KEY")) {
		return "that is not a PEM private key";
	}
	return null;
}

async function askPrivateKey(rl: Interface, fallback: string): Promise<string> {
	console.log(
		`\n${bold("GITHUB_APP_PRIVATE_KEY")}  ${dim("Paste the PEM, or a path to the .pem GitHub downloaded.")}`,
	);

	if (ACCEPT_DEFAULTS) {
		const problem = fallback === "" ? null : checkPem(fallback);
		if (problem !== null) {
			throw new Error(`--yes cannot answer GITHUB_APP_PRIVATE_KEY: ${problem}.`);
		}
		console.log(`  ${dim("using")} ${fallback === "" ? dim("(empty)") : mask(fallback)}`);
		return fallback;
	}

	for (;;) {
		const suffix = fallback === "" ? "" : ` ${dim(`[${mask(fallback)} — current]`)}`;
		const first = (await rl.question(`  ${cyan("›")}${suffix} `)).trim();
		let raw = first === "" ? fallback : first;

		if (raw === "") {
			console.log(`  ${red("✗")} a GitHub App needs a private key`);
			continue;
		}

		if (first !== "" && looksLikePemPath(first)) {
			const path = resolve(process.cwd(), first);
			if (!existsSync(path) || !statSync(path).isFile()) {
				console.log(`  ${red("✗")} no file at ${first}`);
				continue;
			}
			raw = readFileSync(path, "utf8");
		} else if (first.includes("BEGIN") && !first.includes("END")) {
			const lines = [first];
			for (;;) {
				const line = await rl.question(`  ${dim("|")} `);
				lines.push(line);
				if (line.includes("END")) break;
			}
			raw = lines.join("\n");
		}

		const normalized = flattenPem(raw);
		const problem = checkPem(normalized);
		if (problem === null) return normalized;
		console.log(`  ${red("✗")} ${problem}`);
	}
}

interface GithubCreds {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	GITHUB_APP_ID: string;
	GITHUB_APP_SLUG: string;
	GITHUB_APP_PRIVATE_KEY: string;
	GITHUB_APP_WEBHOOK_SECRET: string;
	GITHUB_DEV_TOKEN: string;
	GITHUB_API_URL: string;
}

function existingGithub(existing: Record<string, string>): GithubCreds {
	return {
		GITHUB_CLIENT_ID: existing.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: existing.GITHUB_CLIENT_SECRET ?? "",
		GITHUB_APP_ID: existing.GITHUB_APP_ID ?? "",
		GITHUB_APP_SLUG: existing.GITHUB_APP_SLUG ?? "",
		GITHUB_APP_PRIVATE_KEY: existing.GITHUB_APP_PRIVATE_KEY ?? "",
		GITHUB_APP_WEBHOOK_SECRET: existing.GITHUB_APP_WEBHOOK_SECRET ?? "",
		GITHUB_DEV_TOKEN: existing.GITHUB_DEV_TOKEN ?? "",
		GITHUB_API_URL: existing.GITHUB_API_URL || "https://api.github.com",
	};
}

/**
 * One GitHub App, covering both halves of the integration.
 *
 * Its OAuth credentials sign people in; its App ID and private key mint the
 * installation tokens that read repositories. That is one registration to make
 * and one place for callback URLs to be wrong, rather than two apps whose
 * client IDs differ by a single letter. A personal access token stays available
 * as a development stand-in for the installation, and covers repositories only.
 */
async function setupGithub(
	rl: Interface,
	existing: GithubCreds,
	origin: string,
	appName: string,
	/** A personal access token stands in for an App in development only. */
	allowToken = true,
): Promise<Omit<GithubCreds, "GITHUB_API_URL">> {
	const unchanged = (): Omit<GithubCreds, "GITHUB_API_URL"> => ({
		GITHUB_CLIENT_ID: existing.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: existing.GITHUB_CLIENT_SECRET,
		GITHUB_APP_ID: existing.GITHUB_APP_ID,
		GITHUB_APP_SLUG: existing.GITHUB_APP_SLUG,
		GITHUB_APP_PRIVATE_KEY: existing.GITHUB_APP_PRIVATE_KEY,
		GITHUB_APP_WEBHOOK_SECRET: existing.GITHUB_APP_WEBHOOK_SECRET,
		GITHUB_DEV_TOKEN: allowToken ? existing.GITHUB_DEV_TOKEN : "",
	});

	const hasApp = filled(existing.GITHUB_APP_ID) && filled(existing.GITHUB_APP_PRIVATE_KEY);
	const hasToken = allowToken && filled(existing.GITHUB_DEV_TOKEN);

	if (hasApp) {
		// An App configured before sign-in moved onto it has no client credentials,
		// and nothing else would ever say so — the button is simply missing.
		if (!filled(existing.GITHUB_CLIENT_ID)) {
			console.log(
				`\n  ${dim('This App has no Client ID or secret, so the "Sign in with GitHub" button is hidden. Answer no to add them.')}`,
			);
		}
		if (await confirm(rl, "\nKeep existing GitHub App?", true)) return unchanged();
	} else if (hasToken) {
		if (await confirm(rl, "\nKeep existing GitHub personal access token?", true)) {
			return unchanged();
		}
	} else if (!(await confirm(rl, "\nSet up GitHub sign-in and repository linking?", false))) {
		return unchanged();
	}

	const kind = allowToken
		? await choose(
				rl,
				"How should this app reach GitHub?",
				[
					{ label: "GitHub App", hint: "sign-in and repository access, one registration" },
					{ label: "Personal access token", hint: "repository access only — development" },
				],
				0,
			)
		: 0;

	if (kind === 1) {
		console.log(`\n  Open ${cyan("https://github.com/settings/personal-access-tokens/new")}`);
		console.log();
		console.log("    Token name                  tracker-dev");
		console.log(
			"    Repository access           All repositories, or only the ones you want to try",
		);
		console.log("    Permissions (read-only)     Contents, Metadata, Pull requests");
		console.log();
		console.log("  Generate the token and paste it.");
		if (!filled(existing.GITHUB_CLIENT_ID)) {
			console.log(
				`  ${dim('A token cannot sign anyone in, so the "Sign in with GitHub" button stays hidden.')}`,
			);
		}

		const token = await ask(rl, {
			key: "GITHUB_DEV_TOKEN",
			blurb: "A fine-grained personal access token.",
			schema: v.pipe(v.string(), v.minLength(1, "paste the token")),
			fallback: existing.GITHUB_DEV_TOKEN,
			secret: true,
			origin: filled(existing.GITHUB_DEV_TOKEN) ? "current" : undefined,
		});

		return {
			// Sign-in credentials are left alone: they belong to whatever app is
			// already registered, and a token has nothing to say about them.
			GITHUB_CLIENT_ID: existing.GITHUB_CLIENT_ID,
			GITHUB_CLIENT_SECRET: existing.GITHUB_CLIENT_SECRET,
			GITHUB_APP_ID: "",
			GITHUB_APP_SLUG: "",
			GITHUB_APP_PRIVATE_KEY: "",
			GITHUB_APP_WEBHOOK_SECRET: "",
			GITHUB_DEV_TOKEN: token,
		};
	}

	console.log(`\n  Open ${cyan("https://github.com/settings/apps/new")}`);
	console.log();
	console.log(`    GitHub App name             ${appName}, or anything else unique on GitHub`);
	console.log(`    Homepage URL                ${origin}`);
	console.log(`    Callback URL                ${origin}/api/auth/callback/github`);
	console.log(`    Add callback URL            ${origin}/api/v1/github/callback`);
	console.log(`    Setup URL                   ${origin}/api/v1/github/callback`);
	console.log("    Request user authorization (OAuth) during installation    leave unchecked");
	console.log("    Webhook                     uncheck Active");
	console.log("    Account permissions         Email addresses — Read-only");
	console.log("    Repository permissions      Contents, Metadata, Pull requests — all Read-only");
	console.log("    Where can this GitHub App be installed?    Any account");
	console.log();
	console.log(
		`  Both callback URLs are needed: the first is where signing in returns, the second is where installing returns. ${bold("Email addresses")} is what lets sign-in read an address — without it people arrive with none and cannot be created.`,
	);
	console.log(
		"  Create the app. The App ID and Client ID are on the next page; the slug is the last part of github.com/apps/<slug>. Generate a client secret and a private key at the bottom.",
	);

	const clientId = await ask(rl, {
		key: "GITHUB_CLIENT_ID",
		blurb: "The app's Client ID, which starts with Iv23li.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the Client ID")),
		fallback: existing.GITHUB_CLIENT_ID,
		origin: filled(existing.GITHUB_CLIENT_ID) ? "current" : undefined,
	});
	const clientSecret = await ask(rl, {
		key: "GITHUB_CLIENT_SECRET",
		blurb: "Generate a client secret on the same page.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the client secret")),
		fallback: existing.GITHUB_CLIENT_SECRET,
		secret: true,
		origin: filled(existing.GITHUB_CLIENT_SECRET) ? "current" : undefined,
	});
	const appId = await ask(rl, {
		key: "GITHUB_APP_ID",
		blurb: "A number, shown as App ID — not the Client ID.",
		schema: v.pipe(v.string(), v.regex(/^\d+$/, "the App ID is a number")),
		fallback: existing.GITHUB_APP_ID,
		origin: filled(existing.GITHUB_APP_ID) ? "current" : undefined,
	});
	const slug = await ask(rl, {
		key: "GITHUB_APP_SLUG",
		blurb: "From https://github.com/apps/<slug>.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the slug")),
		fallback: existing.GITHUB_APP_SLUG,
		origin: filled(existing.GITHUB_APP_SLUG) ? "current" : undefined,
	});
	const privateKey = await askPrivateKey(rl, existing.GITHUB_APP_PRIVATE_KEY);
	const webhookSecret =
		existing.GITHUB_APP_WEBHOOK_SECRET === ""
			? randomBytes(20).toString("hex")
			: existing.GITHUB_APP_WEBHOOK_SECRET;

	return {
		GITHUB_CLIENT_ID: clientId,
		GITHUB_CLIENT_SECRET: clientSecret,
		GITHUB_APP_ID: appId,
		GITHUB_APP_SLUG: slug,
		GITHUB_APP_PRIVATE_KEY: privateKey,
		GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
		// The App supersedes the stand-in, and leaving both set is only confusing.
		GITHUB_DEV_TOKEN: "",
	};
}

/** Whichever package manager invoked this, so the printed hints match reality. */
function packageManager(): string {
	const agent = process.env.npm_config_user_agent ?? "";
	if (agent.startsWith("yarn")) return "yarn";
	if (agent.startsWith("npm")) return "npm run";
	if (agent.startsWith("bun")) return "bun run";
	return "pnpm";
}

function run(script: string, env: Record<string, string>): boolean {
	const [command, ...rest] = packageManager().split(" ");
	const result = spawnSync(command as string, [...rest, script], {
		stdio: "inherit",
		// The values were only just written to disk; pass them directly so this
		// does not depend on anything re-reading .env.
		env: { ...process.env, ...env },
		shell: process.platform === "win32",
	});
	return result.status === 0;
}

async function setupDev(): Promise<void> {
	const existing = readExisting();
	const hadEnv = Object.keys(existing).length > 0;

	console.log(`\n${bold("tracker — development setup")}`);
	console.log(
		dim(
			hadEnv
				? "Found an existing .env. Press enter to keep each current value."
				: "This writes a .env. Press enter to accept each [default].",
		),
	);
	if (ACCEPT_DEFAULTS) console.log(dim("Running with --yes: taking every default."));

	// A non-interactive shell cannot answer prompts, and quietly taking defaults
	// there would write a config nobody chose.
	if (!ACCEPT_DEFAULTS && process.stdin.isTTY !== true) {
		console.error(
			`\n${red("✗")} No interactive terminal. Re-run with --yes to accept the defaults.`,
		);
		process.exitCode = 1;
		return;
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	try {
		const values: Record<string, string> = {};

		values.PUBLIC_APP_NAME = await ask(rl, {
			key: "PUBLIC_APP_NAME",
			blurb: "Shown in the browser tab. Ships to the browser, so nothing secret.",
			schema: publicEnvSchema.PUBLIC_APP_NAME,
			fallback: existing.PUBLIC_APP_NAME ?? "tracker",
			origin: existing.PUBLIC_APP_NAME === undefined ? undefined : "current",
		});

		// --- database ---------------------------------------------------------

		const remembered = existing.DATABASE_URL ?? "";
		const wasRemote = remembered !== "" && !remembered.startsWith("file:");

		const where = await choose(
			rl,
			"Where should the database live?",
			[
				{ label: "Local SQLite file", hint: "no account needed — right for development" },
				{ label: "Turso (hosted libSQL)", hint: "what a Vercel deploy needs" },
			],
			wasRemote ? 1 : 0,
		);

		if (where === 0) {
			values.DATABASE_URL = await ask(rl, {
				key: "DATABASE_URL",
				blurb: "Path to the SQLite file, as a file: URL.",
				schema: serverEnvSchema.DATABASE_URL,
				fallback: wasRemote || remembered === "" ? "file:./local.db" : remembered,
			});
			values.DATABASE_AUTH_TOKEN = "";
		} else {
			values.DATABASE_URL = await ask(rl, {
				key: "DATABASE_URL",
				blurb: "Turso database URL — `turso db show <name> --url`.",
				schema: serverEnvSchema.DATABASE_URL,
				fallback: wasRemote ? remembered : "",
			});
			values.DATABASE_AUTH_TOKEN = await ask(rl, {
				key: "DATABASE_AUTH_TOKEN",
				blurb: "Turso auth token — `turso db tokens create <name>`.",
				// Optional in the app (a local file needs none), required here,
				// because a hosted database without one cannot connect.
				schema: v.pipe(v.string(), v.minLength(1, "a hosted database needs a token")),
				fallback: existing.DATABASE_AUTH_TOKEN ?? "",
				secret: true,
				origin: (existing.DATABASE_AUTH_TOKEN ?? "") === "" ? undefined : "current",
			});
		}

		// --- auth -------------------------------------------------------------

		const kept = existing.BETTER_AUTH_SECRET ?? "";
		values.BETTER_AUTH_SECRET = await ask(rl, {
			key: "BETTER_AUTH_SECRET",
			blurb: "Signs session cookies. Changing it signs everyone out.",
			schema: serverEnvSchema.BETTER_AUTH_SECRET,
			fallback: kept === "" ? randomBytes(32).toString("base64") : kept,
			secret: true,
			origin: kept === "" ? "generated" : "current",
		});

		// --- webhooks ----------------------------------------------------------

		const keptCron = existing.CRON_SECRET ?? "";
		values.CRON_SECRET = await ask(rl, {
			key: "CRON_SECRET",
			blurb: "Authorises the webhook retry drain. Blank disables it (and retries with it).",
			schema: serverEnvSchema.CRON_SECRET,
			fallback: keptCron === "" ? randomBytes(24).toString("base64url") : keptCron,
			secret: true,
			origin: keptCron === "" ? "generated" : "current",
		});

		values.BETTER_AUTH_URL = await ask(rl, {
			key: "BETTER_AUTH_URL",
			blurb: "The origin the app is served from. Must match the URL you open.",
			schema: serverEnvSchema.BETTER_AUTH_URL,
			fallback: existing.BETTER_AUTH_URL ?? "http://localhost:5173",
			origin: existing.BETTER_AUTH_URL === undefined ? undefined : "current",
		});

		// --- GitHub -----------------------------------------------------------
		// After BETTER_AUTH_URL so the callback URLs we print match the origin
		// they just confirmed.

		const origin = originOf(values.BETTER_AUTH_URL ?? "http://localhost:5173");
		const previousGithub = existingGithub(existing);
		const github: GithubCreds = {
			...previousGithub,
			...(await setupGithub(rl, previousGithub, origin, values.PUBLIC_APP_NAME ?? "tracker")),
		};

		// Local MinIO (`docker compose up -d`). Kept if already set, so a
		// production R2 config is not overwritten by a later setup run.
		const s3 = {
			S3_ENDPOINT: existing.S3_ENDPOINT ?? "http://localhost:9000",
			S3_REGION: existing.S3_REGION ?? "auto",
			S3_BUCKET: existing.S3_BUCKET ?? "tracker-attachments",
			S3_ACCESS_KEY_ID: existing.S3_ACCESS_KEY_ID ?? "tracker",
			S3_SECRET_ACCESS_KEY: existing.S3_SECRET_ACCESS_KEY ?? "tracker-dev-secret",
			S3_PUBLIC_ENDPOINT: existing.S3_PUBLIC_ENDPOINT ?? "",
		};

		// --- write --------------------------------------------------------------

		console.log(`\n${bold("Summary")}`);
		for (const [key, value] of [
			...Object.entries(values),
			...Object.entries(s3),
			...Object.entries(github),
		]) {
			const shown = value === "" ? dim("(empty)") : SECRET_KEYS.has(key) ? mask(value) : value;
			console.log(`  ${key.padEnd(26)} ${shown}`);
		}

		if (!(await confirm(rl, `\nWrite ${hadEnv ? "over the existing " : ""}.env?`, true))) {
			console.log(dim("\nNothing written."));
			return;
		}

		writeEnvFile(
			renderEnvFile(
				{ ...values, ...s3, ...github },
				existing,
				"# Written by `pnpm setup:dev`. Gitignored — the committed list is .env.example.",
			),
		);
		console.log(`${green("✓")} wrote .env`);

		// --- offer the next two steps -------------------------------------------

		const pm = packageManager();

		if (await confirm(rl, "\nApply database migrations now?", true)) {
			if (run("db:migrate", values)) console.log(`${green("✓")} migrations applied`);
			else console.log(`${red("✗")} failed — run \`${pm} db:migrate\` to retry`);
		}

		if (await confirm(rl, "\nSeed a demo workspace to look at?", !hadEnv)) {
			if (run("db:seed", values)) console.log(`${green("✓")} seeded`);
			else console.log(`${red("✗")} failed — run \`${pm} db:seed\` to retry`);
		}

		console.log(`\n${bold("Ready.")} Start the app with ${cyan(`${pm} dev`)}.`);
		if (filled(github.GITHUB_APP_SLUG)) {
			console.log(dim("Install the GitHub App from Settings → Repositories after you sign in."));
		}
	} finally {
		rl.close();
	}
}

// ---------------------------------------------------------------------------
// production
// ---------------------------------------------------------------------------

/** Is this command on PATH? */
function installed(command: string): boolean {
	const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
		stdio: "ignore",
	});
	return probe.status === 0;
}

/** Run a command and keep its output. */
function capture(command: string, args: string[]): { ok: boolean; out: string } {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

/** Run a command with its output on screen, optionally feeding it stdin. */
function passthrough(command: string, args: string[], input?: string): boolean {
	const result = spawnSync(command, args, {
		stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
		input,
		shell: process.platform === "win32",
	});
	return result.status === 0;
}

let stepNumber = 0;
function step(title: string): void {
	stepNumber += 1;
	console.log(`\n${bold(`${stepNumber}. ${title}`)}`);
}

function ok(message: string): void {
	console.log(`  ${green("✓")} ${message}`);
}

function note(message: string): void {
	console.log(`  ${dim(message)}`);
}

/** Vite 7 needs 20.19+; anything older fails the build in a confusing way. */
function checkNode(): void {
	const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
	if (major > 20 || (major === 20 && minor >= 19)) {
		ok(`Node ${process.versions.node}`);
		return;
	}
	console.log(`  ${red("✗")} Node ${process.versions.node} — this project needs 20.19 or newer.`);
	throw new Error("Upgrade Node, then run this again.");
}

function ensureDependencies(): void {
	if (existsSync(resolve(process.cwd(), "node_modules"))) {
		ok("dependencies installed");
		return;
	}
	const pm = packageManager().split(" ")[0] as string;
	console.log(`  ${dim(`${pm} install`)}`);
	if (!passthrough(pm, ["install"])) throw new Error(`\`${pm} install\` failed.`);
	ok("dependencies installed");
}

/** Turns "https://x.com/" into "https://x.com". */
const PROD_URL = v.pipe(
	v.string(),
	v.url("must be an absolute URL, starting https://"),
	v.check((value) => value.startsWith("https://"), "production should be served over https"),
);

async function askProdOrigin(rl: Interface, fallback: string): Promise<string> {
	const answer = await ask(rl, {
		key: "BETTER_AUTH_URL",
		blurb: "The URL people will open. Sign-in fails if this is not the real one.",
		schema: PROD_URL,
		fallback,
		origin: fallback === "" ? undefined : "current",
	});
	return originOf(answer);
}

// --- database ---------------------------------------------------------------

type DatabaseCreds = {
	DATABASE_URL: string;
	DATABASE_AUTH_TOKEN: string;
};

const TURSO_INSTALL =
	process.platform === "win32"
		? "irm get.tur.so/install.ps1 | iex"
		: "curl -sSfL https://get.tur.so/install.sh | bash";

async function askTursoByHand(rl: Interface, existing: DatabaseCreds): Promise<DatabaseCreds> {
	console.log(`\n  Open ${cyan("https://app.turso.tech")} and create a database.`);
	console.log("  Its page has the URL under Connect, and a Create Token button beside it.");

	return {
		DATABASE_URL: await ask(rl, {
			key: "DATABASE_URL",
			blurb: "Starts libsql://.",
			schema: serverEnvSchema.DATABASE_URL,
			fallback: existing.DATABASE_URL,
			origin: existing.DATABASE_URL === "" ? undefined : "current",
		}),
		DATABASE_AUTH_TOKEN: await ask(rl, {
			key: "DATABASE_AUTH_TOKEN",
			blurb: "The database token.",
			schema: v.pipe(v.string(), v.minLength(1, "a hosted database needs a token")),
			fallback: existing.DATABASE_AUTH_TOKEN,
			secret: true,
			origin: existing.DATABASE_AUTH_TOKEN === "" ? undefined : "current",
		}),
	};
}

/**
 * Creates the Turso database outright when its CLI is available, since the
 * alternative is copying two long strings out of a dashboard by hand.
 */
async function setupDatabase(
	rl: Interface,
	existing: DatabaseCreds,
	appName: string,
): Promise<DatabaseCreds> {
	if (!installed("turso")) {
		note("The Turso CLI is not installed; it can create the database for you.");
		if (await confirm(rl, `  Install it now? ${dim(`(${TURSO_INSTALL})`)}`, true)) {
			const shell = process.platform === "win32" ? "powershell" : "sh";
			const args =
				process.platform === "win32" ? ["-Command", TURSO_INSTALL] : ["-c", TURSO_INSTALL];
			passthrough(shell, args);
		}
		if (!installed("turso")) {
			note("Carrying on by hand — reopen your shell afterwards if you did install it.");
			return askTursoByHand(rl, existing);
		}
	}

	if (!capture("turso", ["auth", "whoami"]).ok) {
		console.log("\n  Signing in to Turso — a browser window will open.");
		passthrough("turso", ["auth", "login"]);
		if (!capture("turso", ["auth", "whoami"]).ok) {
			note("Still signed out.");
			return askTursoByHand(rl, existing);
		}
	}
	ok(`signed in to Turso as ${capture("turso", ["auth", "whoami"]).out}`);

	const name = await ask(rl, {
		key: "Database name",
		blurb: "Created if it does not exist yet.",
		schema: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and -")),
		fallback: appName.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
	});

	const list = capture("turso", ["db", "list"]);
	const exists = list.out.split("\n").some((line) => line.trim().split(/\s+/)[0] === name);

	if (exists) {
		ok(`database ${name} already exists`);
	} else {
		console.log(`  ${dim(`turso db create ${name}`)}`);
		if (!passthrough("turso", ["db", "create", name])) {
			note("Creating it failed.");
			return askTursoByHand(rl, existing);
		}
		ok(`created ${name}`);
	}

	const url = capture("turso", ["db", "show", name, "--url"]);
	const token = capture("turso", ["db", "tokens", "create", name]);
	if (!url.ok || !token.ok || url.out === "" || token.out === "") {
		note("Could not read the database URL and token back.");
		return askTursoByHand(rl, existing);
	}

	ok("database URL and token collected");
	return { DATABASE_URL: url.out, DATABASE_AUTH_TOKEN: token.out };
}

// --- object storage ---------------------------------------------------------

type StorageCreds = {
	S3_ENDPOINT: string;
	S3_REGION: string;
	S3_BUCKET: string;
	S3_ACCESS_KEY_ID: string;
	S3_SECRET_ACCESS_KEY: string;
	S3_PUBLIC_ENDPOINT: string;
};

/** Accepts a full endpoint URL or the bare account ID the dashboard shows. */
function r2Endpoint(input: string): string {
	const trimmed = input.trim();
	if (trimmed.includes("://")) return originOf(trimmed);
	return `https://${trimmed}.r2.cloudflarestorage.com`;
}

async function setupStorage(
	rl: Interface,
	existing: StorageCreds,
	origin: string,
): Promise<StorageCreds> {
	console.log(`\n  Open ${cyan("https://dash.cloudflare.com/?to=/:account/r2/overview")}`);
	console.log();
	console.log("    1  Create bucket — any name, and note it.");
	console.log("    2  Manage R2 API Tokens → Create Account API token.");
	console.log("    3  Permissions: Object Read & Write, scoped to that bucket.");
	console.log("    4  Copy the Access Key ID and Secret Access Key it shows once.");
	console.log();

	const endpoint = await ask(rl, {
		key: "S3_ENDPOINT",
		blurb: "Your account ID, or the full S3 endpoint shown with the token.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the account ID or endpoint")),
		fallback: existing.S3_ENDPOINT,
		origin: existing.S3_ENDPOINT === "" ? undefined : "current",
	});
	const bucket = await ask(rl, {
		key: "S3_BUCKET",
		blurb: "The bucket you just created.",
		schema: v.pipe(v.string(), v.minLength(1, "name the bucket")),
		fallback: existing.S3_BUCKET === "" ? "tracker-attachments" : existing.S3_BUCKET,
	});
	const keyId = await ask(rl, {
		key: "S3_ACCESS_KEY_ID",
		blurb: "From the API token.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the access key ID")),
		fallback: existing.S3_ACCESS_KEY_ID,
		origin: existing.S3_ACCESS_KEY_ID === "" ? undefined : "current",
	});
	const secret = await ask(rl, {
		key: "S3_SECRET_ACCESS_KEY",
		blurb: "From the same token.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the secret access key")),
		fallback: existing.S3_SECRET_ACCESS_KEY,
		secret: true,
		origin: existing.S3_SECRET_ACCESS_KEY === "" ? undefined : "current",
	});

	// The browser PUTs straight to the bucket, so the bucket has to accept
	// cross-origin PUTs from the app — this is not optional for attachments.
	const cors = JSON.stringify(
		[
			{
				AllowedOrigins: [origin],
				AllowedMethods: ["GET", "PUT", "HEAD"],
				AllowedHeaders: ["*"],
				ExposeHeaders: ["ETag"],
				MaxAgeSeconds: 3600,
			},
		],
		null,
		2,
	);

	console.log(`\n  Last thing: paste this into the bucket's ${bold("Settings → CORS policy")}.`);
	console.log("  Uploads go from the browser to the bucket, so without it they fail.");
	console.log();
	for (const line of cors.split("\n")) console.log(`    ${cyan(line)}`);
	console.log();
	await confirm(rl, "  Saved it?", true);

	return {
		S3_ENDPOINT: r2Endpoint(endpoint),
		S3_REGION: existing.S3_REGION === "" ? "auto" : existing.S3_REGION,
		S3_BUCKET: bucket,
		S3_ACCESS_KEY_ID: keyId,
		S3_SECRET_ACCESS_KEY: secret,
		// R2 is reachable at the same host from both sides.
		S3_PUBLIC_ENDPOINT: "",
	};
}

// --- host -------------------------------------------------------------------

/**
 * kit writes `.vercel/output` (Build Output API). The CLI still offers Vite's
 * `dist` preset because of `vite.config.ts`; `vercel.json` overrides that, and
 * we patch the linked project so the dashboard matches.
 */
const VERCEL_BUILD_COMMAND = "pnpm build";
const VERCEL_DEV_COMMAND = "pnpm dev";
const VERCEL_INSTALL_COMMAND = "pnpm install";
const VERCEL_OUTPUT_DIRECTORY = ".vercel/output";
const VERCEL_PROJECT_JSON = resolve(process.cwd(), ".vercel/project.json");

type VercelProjectLink = {
	orgId: string;
	projectId: string;
};

function readVercelLink(): VercelProjectLink | null {
	if (!existsSync(VERCEL_PROJECT_JSON)) return null;
	try {
		const parsed = JSON.parse(readFileSync(VERCEL_PROJECT_JSON, "utf8")) as VercelProjectLink;
		if (parsed.orgId && parsed.projectId) return parsed;
	} catch {
		return null;
	}
	return null;
}

function vercelVersion(): [number, number, number] | null {
	const match = capture("vercel", ["--version"]).out.match(/(\d+)\.(\d+)\.(\d+)/);
	if (match === null) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function vercelAtLeast(major: number, minor: number, patch: number): boolean {
	const version = vercelVersion();
	if (version === null) return false;
	if (version[0] !== major) return version[0] > major;
	if (version[1] !== minor) return version[1] > minor;
	return version[2] >= patch;
}

function vercelToken(): string | undefined {
	if (filled(process.env.VERCEL_TOKEN)) return process.env.VERCEL_TOKEN;

	const home = homedir();
	const files = [
		join(home, "Library/Application Support/com.vercel.cli/auth.json"),
		join(home, ".local/share/com.vercel.cli/auth.json"),
		join(home, ".config/com.vercel.cli/auth.json"),
		join(home, ".config/vercel/auth.json"),
		join(home, ".vercel/auth.json"),
	];
	if (process.env.XDG_DATA_HOME) {
		files.unshift(join(process.env.XDG_DATA_HOME, "com.vercel.cli/auth.json"));
	}

	for (const file of files) {
		try {
			if (!existsSync(file)) continue;
			const parsed = JSON.parse(readFileSync(file, "utf8")) as { token?: string };
			if (typeof parsed.token === "string" && parsed.token !== "") return parsed.token;
		} catch {
			continue;
		}
	}
	return undefined;
}

function vercelProjectSettingsPath(link: VercelProjectLink): string {
	const query = link.orgId.startsWith("team_") ? `?teamId=${encodeURIComponent(link.orgId)}` : "";
	return `/v9/projects/${encodeURIComponent(link.projectId)}${query}`;
}

const VERCEL_PROJECT_PATCH = {
	framework: null,
	buildCommand: VERCEL_BUILD_COMMAND,
	devCommand: VERCEL_DEV_COMMAND,
	installCommand: VERCEL_INSTALL_COMMAND,
	outputDirectory: VERCEL_OUTPUT_DIRECTORY,
};

async function patchVercelProjectHttp(link: VercelProjectLink, token: string): Promise<boolean> {
	try {
		const res = await fetch(`https://api.vercel.com${vercelProjectSettingsPath(link)}`, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(VERCEL_PROJECT_PATCH),
		});
		return res.ok;
	} catch {
		return false;
	}
}

let vercelProjectConfigured = false;

/** Other + `pnpm build`, so git deploys pick up `.vercel/output` instead of Vite's `dist`. */
async function configureVercelProject(): Promise<boolean> {
	// `vercel project update` landed in 54.21.1. Older CLIs treat unknown
	// subcommands as `deploy <path>`, so do not probe `vercel api` / `project`.
	if (vercelAtLeast(54, 21, 1)) {
		return passthrough("vercel", [
			"project",
			"update",
			"--framework",
			"other",
			"--build-command",
			VERCEL_BUILD_COMMAND,
			"--dev-command",
			VERCEL_DEV_COMMAND,
			"--install-command",
			VERCEL_INSTALL_COMMAND,
			"--output-directory",
			VERCEL_OUTPUT_DIRECTORY,
		]);
	}

	const link = readVercelLink();
	const token = vercelToken();
	if (link === null || token === undefined) return false;
	return patchVercelProjectHttp(link, token);
}

async function linkVercelProject(): Promise<boolean> {
	if (!existsSync(VERCEL_PROJECT_JSON)) {
		console.log(`  ${dim("vercel link")}`);
		note("When it offers Vite settings, press enter.");
		if (!passthrough("vercel", ["link"])) return false;
	}

	if (await configureVercelProject()) {
		ok(`project settings: Other, ${VERCEL_BUILD_COMMAND}`);
	} else {
		note("Set Framework Preset to Other in Vercel → Settings → Build and Deployment.");
	}
	vercelProjectConfigured = true;
	return true;
}

/** Pushes the finished environment to Vercel, or explains how to paste it. */
async function pushToVercel(rl: Interface, all: Record<string, string>): Promise<void> {
	const entries = KNOWN_KEYS.map((key) => [key, all[key] ?? ""] as const).filter(
		([, value]) => value !== "",
	);

	if (!installed("vercel")) {
		console.log(`\n  Open your project on ${cyan("https://vercel.com")} →`);
		console.log(`  ${bold("Settings → Environment Variables")}, switch to ${bold("Production")},`);
		console.log(`  and paste the contents of ${bold(ENV_FILE.prod)} into the import box.`);
		note("`npm i -g vercel` lets this script do it for you next time.");
		return;
	}

	if (!(await confirm(rl, "\nPush these to Vercel now?", true))) {
		note(`Skipped — ${ENV_FILE.prod} is on disk to paste in later.`);
		return;
	}

	if (!(await linkVercelProject())) {
		note("Linking failed; paste the file into the dashboard instead.");
		return;
	}

	for (const [key, value] of entries) {
		// `env add` refuses to overwrite, so clear it first. A key that was never
		// there makes this fail harmlessly.
		spawnSync("vercel", ["env", "rm", key, "production", "--yes"], { stdio: "ignore" });
		const added = spawnSync("vercel", ["env", "add", key, "production"], {
			input: value,
			stdio: ["pipe", "ignore", "pipe"],
			encoding: "utf8",
		});
		if (added.status === 0) console.log(`  ${green("✓")} ${key}`);
		else console.log(`  ${red("✗")} ${key} — add it by hand`);
	}
}

async function setupProd(): Promise<void> {
	console.log(`\n${bold("tracker — production setup")}`);
	console.log(
		dim(
			`Writes ${ENV_FILE.prod}, then hands it to your host. Anything already set is skipped; --all revisits everything.`,
		),
	);

	if (process.stdin.isTTY !== true) {
		console.error(`\n${red("✗")} No interactive terminal. Production setup needs one.`);
		process.exitCode = 1;
		return;
	}

	const existing = readExisting();
	const settled = (...keys: string[]): boolean =>
		!REVISIT_ALL && keys.every((key) => filled(existing[key]));

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	try {
		step("Prerequisites");
		checkNode();
		ensureDependencies();

		step("Where it will live");
		let origin: string;
		if (settled("BETTER_AUTH_URL")) {
			origin = originOf(existing.BETTER_AUTH_URL as string);
			ok(origin);
		} else {
			origin = await askProdOrigin(rl, existing.BETTER_AUTH_URL ?? "");
		}

		step("Name");
		let appName: string;
		if (settled("PUBLIC_APP_NAME")) {
			appName = existing.PUBLIC_APP_NAME as string;
			ok(appName);
		} else {
			appName = await ask(rl, {
				key: "PUBLIC_APP_NAME",
				blurb: "Shown in the browser tab.",
				schema: publicEnvSchema.PUBLIC_APP_NAME,
				fallback: existing.PUBLIC_APP_NAME ?? "tracker",
			});
		}

		step("Secrets");
		const authSecret = filled(existing.BETTER_AUTH_SECRET)
			? (existing.BETTER_AUTH_SECRET as string)
			: randomBytes(32).toString("base64");
		const cronSecret = filled(existing.CRON_SECRET)
			? (existing.CRON_SECRET as string)
			: randomBytes(24).toString("base64url");
		ok(
			filled(existing.BETTER_AUTH_SECRET)
				? "BETTER_AUTH_SECRET kept"
				: "BETTER_AUTH_SECRET generated",
		);
		ok(filled(existing.CRON_SECRET) ? "CRON_SECRET kept" : "CRON_SECRET generated");

		step("Database");
		let database: DatabaseCreds;
		if (settled("DATABASE_URL", "DATABASE_AUTH_TOKEN")) {
			database = {
				DATABASE_URL: existing.DATABASE_URL as string,
				DATABASE_AUTH_TOKEN: existing.DATABASE_AUTH_TOKEN as string,
			};
			ok(database.DATABASE_URL);
		} else {
			database = await setupDatabase(
				rl,
				{
					DATABASE_URL: existing.DATABASE_URL?.startsWith("file:")
						? ""
						: (existing.DATABASE_URL ?? ""),
					DATABASE_AUTH_TOKEN: existing.DATABASE_AUTH_TOKEN ?? "",
				},
				appName,
			);
		}

		step("File storage");
		let storage: StorageCreds;
		if (settled("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")) {
			storage = {
				S3_ENDPOINT: existing.S3_ENDPOINT as string,
				S3_REGION: existing.S3_REGION || "auto",
				S3_BUCKET: existing.S3_BUCKET as string,
				S3_ACCESS_KEY_ID: existing.S3_ACCESS_KEY_ID as string,
				S3_SECRET_ACCESS_KEY: existing.S3_SECRET_ACCESS_KEY as string,
				S3_PUBLIC_ENDPOINT: existing.S3_PUBLIC_ENDPOINT ?? "",
			};
			ok(`${storage.S3_BUCKET} at ${storage.S3_ENDPOINT}`);
		} else {
			const previous = {
				S3_ENDPOINT: existing.S3_ENDPOINT?.includes("localhost")
					? ""
					: (existing.S3_ENDPOINT ?? ""),
				S3_REGION: existing.S3_REGION ?? "auto",
				S3_BUCKET: existing.S3_BUCKET === "tracker-attachments" ? "" : (existing.S3_BUCKET ?? ""),
				S3_ACCESS_KEY_ID:
					existing.S3_ACCESS_KEY_ID === "tracker" ? "" : (existing.S3_ACCESS_KEY_ID ?? ""),
				S3_SECRET_ACCESS_KEY: existing.S3_SECRET_ACCESS_KEY ?? "",
				S3_PUBLIC_ENDPOINT: "",
			};
			storage = await setupStorage(rl, previous, origin);
		}

		step("GitHub");
		const previousGithub = existingGithub(existing);
		let github: GithubCreds;
		if (settled("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_SLUG")) {
			github = { ...previousGithub, GITHUB_DEV_TOKEN: "" };
			ok("sign-in and repository access configured");
		} else {
			github = {
				...previousGithub,
				...(await setupGithub(rl, previousGithub, origin, appName, false)),
				GITHUB_DEV_TOKEN: "",
			};
		}

		// --- write ------------------------------------------------------------

		const all: Record<string, string> = {
			PUBLIC_APP_NAME: appName,
			BETTER_AUTH_URL: origin,
			BETTER_AUTH_SECRET: authSecret,
			CRON_SECRET: cronSecret,
			...database,
			...storage,
			...github,
		};

		step(`Write ${ENV_FILE.prod}`);
		for (const key of KNOWN_KEYS) {
			const value = all[key] ?? "";
			const shown = value === "" ? dim("(empty)") : SECRET_KEYS.has(key) ? mask(value) : value;
			console.log(`  ${key.padEnd(26)} ${shown}`);
		}

		if (!(await confirm(rl, `\nWrite ${ENV_FILE.prod}?`, true))) {
			console.log(dim("\nNothing written."));
			return;
		}

		writeEnvFile(
			renderEnvFile(
				all,
				existing,
				`# Written by \`pnpm setup:prod\`. Gitignored. Real credentials — do not commit.`,
			),
		);
		ok(`wrote ${ENV_FILE.prod}`);

		step("Host");
		await pushToVercel(rl, all);

		// --- the irreversible part, last ---------------------------------------

		const pm = packageManager();

		step("Migrate");
		console.log(`  ${yellow("!")} This writes to ${bold(database.DATABASE_URL)}.`);
		if (await confirm(rl, "  Apply migrations to the production database?", false)) {
			if (run("db:migrate", database)) ok("migrations applied");
			else console.log(`  ${red("✗")} failed — run \`${pm} db:migrate\` to retry`);
		} else {
			note(`The app will not work until you run \`${pm} db:migrate\` against it.`);
		}

		step("Deploy");
		if (installed("vercel") && (await confirm(rl, "  Build and deploy now?", false))) {
			if (!vercelProjectConfigured && !(await linkVercelProject())) {
				note(
					"Linking failed; deploy from a linked directory with `vercel deploy --prebuilt --prod`.",
				);
			} else if (run("build", all) && passthrough("vercel", ["deploy", "--prebuilt", "--prod"])) {
				ok("deployed");
			} else {
				console.log(`  ${red("✗")} failed — see the output above`);
			}
		} else {
			note(`Deploy with \`${pm} build && vercel deploy --prebuilt --prod\`.`);
		}

		console.log(`\n${bold("Done.")} ${cyan(origin)}`);
		if (filled(github.GITHUB_APP_SLUG)) {
			note("Install the GitHub App from Settings → Repositories once you sign in.");
		}
		note(`${ENV_FILE.prod} holds live credentials; keep it off shared machines.`);
	} finally {
		rl.close();
	}
}

if (MODE === "prod") await setupProd();
else await setupDev();
