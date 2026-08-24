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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import * as v from "valibot";
import { publicEnvSchema, serverEnvSchema } from "../src/lib/env.schema";

const ENV_PATH = resolve(process.cwd(), ".env");
const ACCEPT_DEFAULTS = process.argv.includes("--yes") || process.argv.includes("-y");

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

		// --- write --------------------------------------------------------------

		console.log(`\n${bold("Summary")}`);
		for (const [key, value] of Object.entries(values)) {
			const secret =
				key === "BETTER_AUTH_SECRET" || key === "DATABASE_AUTH_TOKEN" || key === "CRON_SECRET";
			const shown = value === "" ? dim("(empty)") : secret ? mask(value) : value;
			console.log(`  ${key.padEnd(21)} ${shown}`);
		}

		if (!(await confirm(rl, `\nWrite ${hadEnv ? "over the existing " : ""}.env?`, true))) {
			console.log(dim("\nNothing written."));
			return;
		}

		const file = [
			"# Written by `pnpm dev:setup`. Gitignored — the committed list is .env.example.",
			"",
			`PUBLIC_APP_NAME=${values.PUBLIC_APP_NAME}`,
			"",
			"# libSQL. A local file in dev; a Turso URL (libsql://...) in production.",
			`DATABASE_URL=${values.DATABASE_URL}`,
			"# Only needed for a remote Turso database.",
			`DATABASE_AUTH_TOKEN=${values.DATABASE_AUTH_TOKEN}`,
			"",
			"# Signs session cookies.",
			`BETTER_AUTH_SECRET=${values.BETTER_AUTH_SECRET}`,
			`BETTER_AUTH_URL=${values.BETTER_AUTH_URL}`,
			"",
			"# Authorises POST /api/v1/webhooks/drain, which retries failed webhook",
			"# deliveries. Blank closes that route.",
			`CRON_SECRET=${values.CRON_SECRET}`,
			"",
		].join("\n");

		// 0600: the file holds a signing secret and possibly a database token.
		writeFileSync(ENV_PATH, file, { mode: 0o600 });
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
	} finally {
		rl.close();
	}
}

await main();
