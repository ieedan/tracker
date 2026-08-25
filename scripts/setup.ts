/**
 * Interactive environment setup.
 *
 *   pnpm dev:setup            walk through every value
 *   pnpm dev:setup --yes      accept every default, no prompts (CI, containers)
 *
 * Answers are validated against `src/lib/env.schema.ts` — the same schemas
 * `defineEnv` enforces at build time — so a `.env` written here cannot be one
 * the app then refuses to start with.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import * as v from "valibot";
import { publicEnvSchema, serverEnvSchema } from "../src/lib/env.schema";

const ENV_PATH = resolve(process.cwd(), ".env");
const ACCEPT_DEFAULTS = process.argv.includes("--yes") || process.argv.includes("-y");

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

async function setupGithubSignIn(
	rl: Interface,
	existing: GithubCreds,
	origin: string,
	appName: string,
): Promise<Pick<GithubCreds, "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET">> {
	const already = filled(existing.GITHUB_CLIENT_ID) && filled(existing.GITHUB_CLIENT_SECRET);
	const proceed = already
		? !(await confirm(rl, "\nKeep existing GitHub sign-in?", true))
		: await confirm(rl, "\nSet up GitHub sign-in?", false);

	if (!proceed) {
		return {
			GITHUB_CLIENT_ID: existing.GITHUB_CLIENT_ID,
			GITHUB_CLIENT_SECRET: existing.GITHUB_CLIENT_SECRET,
		};
	}

	console.log(`\n  Open ${cyan("https://github.com/settings/applications/new")}`);
	console.log();
	console.log(`    Application name             ${appName}`);
	console.log(`    Homepage URL                 ${origin}`);
	console.log(`    Authorization callback URL   ${origin}/api/auth/callback/github`);
	console.log();
	console.log(
		"  Create the app, then paste the Client ID. Generate a client secret and paste that next.",
	);

	const id = await ask(rl, {
		key: "GITHUB_CLIENT_ID",
		blurb: "From the OAuth app page.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the Client ID")),
		fallback: existing.GITHUB_CLIENT_ID,
		origin: filled(existing.GITHUB_CLIENT_ID) ? "current" : undefined,
	});
	const secret = await ask(rl, {
		key: "GITHUB_CLIENT_SECRET",
		blurb: "Generate a new client secret on the same page.",
		schema: v.pipe(v.string(), v.minLength(1, "paste the client secret")),
		fallback: existing.GITHUB_CLIENT_SECRET,
		secret: true,
		origin: filled(existing.GITHUB_CLIENT_SECRET) ? "current" : undefined,
	});

	return { GITHUB_CLIENT_ID: id, GITHUB_CLIENT_SECRET: secret };
}

async function setupGithubRepos(
	rl: Interface,
	existing: GithubCreds,
	origin: string,
): Promise<Omit<GithubCreds, "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "GITHUB_API_URL">> {
	const hasApp = filled(existing.GITHUB_APP_ID) && filled(existing.GITHUB_APP_PRIVATE_KEY);
	const hasToken = filled(existing.GITHUB_DEV_TOKEN);

	if (hasApp) {
		if (await confirm(rl, "\nKeep existing GitHub App?", true)) {
			return {
				GITHUB_APP_ID: existing.GITHUB_APP_ID,
				GITHUB_APP_SLUG: existing.GITHUB_APP_SLUG,
				GITHUB_APP_PRIVATE_KEY: existing.GITHUB_APP_PRIVATE_KEY,
				GITHUB_APP_WEBHOOK_SECRET: existing.GITHUB_APP_WEBHOOK_SECRET,
				GITHUB_DEV_TOKEN: existing.GITHUB_DEV_TOKEN,
			};
		}
	} else if (hasToken) {
		if (await confirm(rl, "\nKeep existing GitHub personal access token?", true)) {
			return {
				GITHUB_APP_ID: "",
				GITHUB_APP_SLUG: "",
				GITHUB_APP_PRIVATE_KEY: "",
				GITHUB_APP_WEBHOOK_SECRET: "",
				GITHUB_DEV_TOKEN: existing.GITHUB_DEV_TOKEN,
			};
		}
	} else if (!(await confirm(rl, "\nSet up repository linking?", false))) {
		return {
			GITHUB_APP_ID: "",
			GITHUB_APP_SLUG: "",
			GITHUB_APP_PRIVATE_KEY: "",
			GITHUB_APP_WEBHOOK_SECRET: "",
			GITHUB_DEV_TOKEN: "",
		};
	}

	const kind = await choose(
		rl,
		"How should this app reach GitHub repositories?",
		[
			{ label: "GitHub App", hint: "install on an org — what the Settings page uses" },
			{ label: "Personal access token", hint: "development only" },
		],
		0,
	);

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

		const token = await ask(rl, {
			key: "GITHUB_DEV_TOKEN",
			blurb: "A fine-grained personal access token.",
			schema: v.pipe(v.string(), v.minLength(1, "paste the token")),
			fallback: existing.GITHUB_DEV_TOKEN,
			secret: true,
			origin: filled(existing.GITHUB_DEV_TOKEN) ? "current" : undefined,
		});

		return {
			GITHUB_APP_ID: "",
			GITHUB_APP_SLUG: "",
			GITHUB_APP_PRIVATE_KEY: "",
			GITHUB_APP_WEBHOOK_SECRET: "",
			GITHUB_DEV_TOKEN: token,
		};
	}

	console.log(`\n  Open ${cyan("https://github.com/settings/apps/new")}`);
	console.log();
	console.log(`    GitHub App name             anything unique`);
	console.log(`    Homepage URL                ${origin}`);
	console.log(`    Callback URL                ${origin}/api/v1/github/callback`);
	console.log(`    Setup URL                   ${origin}/api/v1/github/callback`);
	console.log("    Webhook                     uncheck Active");
	console.log("    Repository permissions      Contents, Metadata, Pull requests — all Read-only");
	console.log("    Where can this GitHub App be installed?    Any account");
	console.log();
	console.log(
		"  Create the app. The App ID is on the next page; the slug is the last part of github.com/apps/<slug>. Generate a private key at the bottom.",
	);

	const appId = await ask(rl, {
		key: "GITHUB_APP_ID",
		blurb: "A number, shown as App ID on the app page.",
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
		GITHUB_APP_ID: appId,
		GITHUB_APP_SLUG: slug,
		GITHUB_APP_PRIVATE_KEY: privateKey,
		GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
		GITHUB_DEV_TOKEN: existing.GITHUB_DEV_TOKEN,
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

async function main(): Promise<void> {
	const existing = readExisting();
	const hadEnv = Object.keys(existing).length > 0;

	console.log(`\n${bold("tracker — environment setup")}`);
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
			...(await setupGithubSignIn(rl, previousGithub, origin, values.PUBLIC_APP_NAME ?? "tracker")),
			...(await setupGithubRepos(rl, previousGithub, origin)),
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

		const file = [
			"# Written by `pnpm dev:setup`. Gitignored — the committed list is .env.example.",
			"",
			envLine("PUBLIC_APP_NAME", values.PUBLIC_APP_NAME),
			"",
			"# libSQL. A local file in dev; a Turso URL (libsql://...) in production.",
			envLine("DATABASE_URL", values.DATABASE_URL),
			"# Only needed for a remote Turso database.",
			envLine("DATABASE_AUTH_TOKEN", values.DATABASE_AUTH_TOKEN),
			"",
			"# Signs session cookies.",
			envLine("BETTER_AUTH_SECRET", values.BETTER_AUTH_SECRET),
			envLine("BETTER_AUTH_URL", values.BETTER_AUTH_URL),
			"",
			"# Authorises POST /api/v1/webhooks/drain, which retries failed webhook",
			"# deliveries. Blank closes that route.",
			envLine("CRON_SECRET", values.CRON_SECRET),
			"",
			"# Object storage for attachments. `docker compose up -d` runs MinIO locally.",
			envLine("S3_ENDPOINT", s3.S3_ENDPOINT),
			envLine("S3_REGION", s3.S3_REGION),
			envLine("S3_BUCKET", s3.S3_BUCKET),
			envLine("S3_ACCESS_KEY_ID", s3.S3_ACCESS_KEY_ID),
			envLine("S3_SECRET_ACCESS_KEY", s3.S3_SECRET_ACCESS_KEY),
			"# Only when the browser reaches storage at a different host than the server does.",
			envLine("S3_PUBLIC_ENDPOINT", s3.S3_PUBLIC_ENDPOINT),
			"",
			"# --- GitHub -----------------------------------------------------------------",
			"# OAuth app: Sign in with GitHub. Blank hides the button.",
			envLine("GITHUB_CLIENT_ID", github.GITHUB_CLIENT_ID),
			envLine("GITHUB_CLIENT_SECRET", github.GITHUB_CLIENT_SECRET),
			"",
			"# GitHub App: repository access. Blank leaves linking unavailable.",
			envLine("GITHUB_APP_ID", github.GITHUB_APP_ID),
			envLine("GITHUB_APP_SLUG", github.GITHUB_APP_SLUG),
			envLine("GITHUB_APP_PRIVATE_KEY", github.GITHUB_APP_PRIVATE_KEY),
			envLine("GITHUB_APP_WEBHOOK_SECRET", github.GITHUB_APP_WEBHOOK_SECRET),
			"",
			"# Development only. Ignored when GITHUB_APP_ID is set.",
			envLine("GITHUB_DEV_TOKEN", github.GITHUB_DEV_TOKEN),
			envLine("GITHUB_API_URL", github.GITHUB_API_URL),
			"",
		];

		const known = new Set([
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
		]);
		const extras = Object.entries(existing).filter(([key]) => !known.has(key));
		if (extras.length > 0) {
			file.push(
				"# Kept from the existing .env.",
				...extras.map(([key, value]) => envLine(key, value)),
				"",
			);
		}

		// 0600: the file holds a signing secret and possibly a database token.
		writeFileSync(ENV_PATH, file.join("\n"), { mode: 0o600 });
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

await main();
