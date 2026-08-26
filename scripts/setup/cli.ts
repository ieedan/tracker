#!/usr/bin/env node
/**
 * Interactive setup, for all three environments.
 *
 *   pnpm setup:dev        this machine — writes .env
 *   pnpm setup:preview    Vercel previews — writes .env.preview
 *   pnpm setup:prod       a real deployment — writes .env.production
 *
 * Answers are validated against `src/lib/env.schema.ts` — the same schemas
 * `defineEnv` enforces at build time — so a file written here cannot be one the
 * app then refuses to start with.
 *
 * A run that is interrupted leaves a draft in `.temp`, and offers to pick up
 * from the step it stopped on.
 */
import { isTTY } from "@clack/prompts";
import dotenvx from "@dotenvx/dotenvx";
import { Command, Option, program } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ENV_FILE } from "./lib/env-file.ts";
import { pm, scriptCommand } from "./lib/exec.ts";
import { askConfirm, color, intro, log, outro, warn } from "./lib/ui.ts";
import type { SetupData, SetupMode, SetupOptions, Step, StepContext } from "./lib/types.ts";
import {
	appName,
	appUrl,
	migrateAndSeed,
	prerequisites,
	secrets,
	writeEnv,
} from "./steps/common.ts";
import {
	developmentDatabase,
	previewDatabase,
	productionDatabase,
	seedPreviewTemplate,
} from "./steps/database.ts";
import { github } from "./steps/github.ts";
import { deploy, pushEnvironment, pushToVercel } from "./steps/host.ts";
import { deploymentStorage, developmentStorage } from "./steps/storage.ts";

const commonOptions = {
	fresh: new Option("-f, --fresh", "Ignore any existing setup and start from scratch."),
	cwd: new Option("--cwd <path>", "The path to the project directory.").default(process.cwd()),
};

const setupSchema = z.object({
	fresh: z.boolean().default(false),
	cwd: z.string().default(process.cwd()),
});

const draftSchema = z.object({
	mode: z.enum(["dev", "preview", "prod"]),
	step: z.string(),
	data: z.object({
		values: z.record(z.string(), z.string()).default({}),
		choices: z.record(z.string(), z.unknown()).default({}),
	}),
});

type Draft = z.infer<typeof draftSchema>;

type DraftState = { status: "none" } | { status: "unreadable" } | { status: "ok"; draft: Draft };

/** Beside this file, so the `.gitignore` next to it covers the drafts. */
const TEMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".temp");

class DraftManager {
	constructor(private mode: SetupMode) {}

	path() {
		return path.join(TEMP_DIR, `setup-${this.mode}.json`);
	}

	/** Reading never deletes: what to do about a bad draft is the caller's call. */
	read(): DraftState {
		const file = this.path();
		if (!fs.existsSync(file)) return { status: "none" };

		try {
			const parsed = draftSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
			return parsed.mode === this.mode ? { status: "ok", draft: parsed } : { status: "none" };
		} catch {
			return { status: "unreadable" };
		}
	}

	write(draft: Draft) {
		const file = this.path();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		// 0600: a half-finished run holds whatever the steps have collected, which
		// is usually the same secrets the .env will.
		fs.writeFileSync(file, `${JSON.stringify(draft, null, "\t")}\n`, { mode: 0o600 });
	}

	discard() {
		fs.rmSync(this.path(), { force: true });
	}
}

async function prepareEnvironment(
	args: unknown,
): Promise<{ env: Record<string, Record<string, string>> | null; options: SetupOptions }> {
	const options = setupSchema.parse(args);

	if (options.fresh) return { options, env: null };

	const files = await dotenvx.ls(options.cwd, [".env", ".env.*"], []);

	const env: Record<string, Record<string, string>> = {};
	for (const file of files) {
		// `ls` reports paths relative to `cwd`; reading one without resolving it
		// against `cwd` again would quietly load the calling directory's file.
		env[file] = dotenvx.parse(fs.readFileSync(path.resolve(options.cwd, file), "utf8"));
	}

	return { options, env };
}

async function resolveDraft(
	drafts: DraftManager,
	options: SetupOptions,
	steps: Step[],
): Promise<{ startIndex: number; data: SetupData }> {
	const empty: SetupData = { values: {}, choices: {} };
	const fresh = () => {
		drafts.discard();
		return { startIndex: 0, data: empty };
	};

	if (options.fresh) return fresh();

	const state = drafts.read();
	if (state.status === "none") return { startIndex: 0, data: empty };

	if (state.status === "unreadable") {
		warn("The last run left a draft this version cannot read. Starting fresh.");
		return fresh();
	}

	const { draft } = state;
	const startIndex = steps.findIndex((step) => step.name === draft.step);

	// The step it stopped on is gone — setup gained or renamed one since. The
	// answers behind it are still good, and some of them cost something to
	// produce, so they are offered back rather than quietly dropped.
	if (startIndex === -1) {
		warn(`The last run stopped on "${draft.step}", which is no longer a step.`);
		if (!(await askConfirm("Reuse the answers it had already collected?", true))) return fresh();
		return { startIndex: 0, data: draft.data as SetupData };
	}

	if (!(await askConfirm(`Resume the last run, from "${draft.step}"?`, true))) return fresh();

	return { startIndex, data: draft.data as SetupData };
}

const TITLES: Record<SetupMode, string> = {
	dev: "tracker — development setup",
	preview: "tracker — preview setup",
	prod: "tracker — production setup",
};

/** What is left to do once the steps are through, given what the run did. */
function nextSteps(ctx: StepContext): string {
	const { choices, values } = ctx.data;
	const lines: string[] = [];

	if (ctx.mode === "dev") {
		lines.push(`Start the app with ${color.cyan(scriptCommand("dev"))}.`);
		if (choices.seeded === true) lines.push("Sign in as demo@tracker.dev / password123.");
		else if (choices.migrated === true)
			lines.push("The database is empty — sign up to create an account.");
		if (choices.storageRunning !== true) {
			lines.push(`Attachments need storage: ${color.cyan("docker compose up -d")}.`);
		}
	}

	if (ctx.mode === "preview") {
		lines.push("Every preview deployment now branches its own database from the template.");
		if (choices.pushedToVercel !== true) {
			lines.push(`Push ${ENV_FILE.preview} to Vercel's Preview environment before deploying.`);
		}
		lines.push(
			`Remove the databases of merged branches with ${color.cyan(`${pm} preview:prune`)}.`,
		);
	}

	if (ctx.mode === "prod") {
		lines.push(color.cyan(values.BETTER_AUTH_URL ?? ""));
		if (choices.migrated !== true) {
			lines.push(
				`The app will not run until ${color.cyan(scriptCommand("db:migrate"))} is applied.`,
			);
		}
		lines.push(`${ENV_FILE.prod} holds live credentials; keep it off shared machines.`);
	}

	if ((values.GITHUB_APP_SLUG ?? "") !== "") {
		lines.push("Install the GitHub App from Settings → Repositories once you sign in.");
	}

	return lines.join("\n");
}

async function runSetup(mode: SetupMode, rawOptions: unknown, steps: Step[]) {
	intro(color.bgCyan(color.black(` ${TITLES[mode]} `)));

	if (!isTTY(process.stdout)) {
		log.error("Setup needs an interactive terminal.");
		process.exit(1);
	}

	const { options, env } = await prepareEnvironment(rawOptions);
	const drafts = new DraftManager(mode);
	const { startIndex, data } = await resolveDraft(drafts, options, steps);
	const ctx: StepContext = { options, env, mode, data };

	for (let i = startIndex; i < steps.length; i++) {
		const step = steps[i];
		if (!step) continue;
		drafts.write({ mode, step: step.name, data: ctx.data });
		await step.run(ctx);
	}

	drafts.discard();
	outro(nextSteps(ctx));
}

const dev = new Command("dev")
	.description("Set this project up on this machine.")
	.addOption(commonOptions.fresh)
	.addOption(commonOptions.cwd)
	.action(async (rawOptions) => {
		await runSetup("dev", rawOptions, [
			prerequisites,
			appName,
			appUrl,
			secrets,
			developmentDatabase,
			developmentStorage,
			github,
			writeEnv,
			migrateAndSeed,
		]);
	});

const preview = new Command("preview")
	.description("Give every Vercel preview deployment its own seeded database.")
	.addOption(commonOptions.fresh)
	.addOption(commonOptions.cwd)
	.action(async (rawOptions) => {
		await runSetup("preview", rawOptions, [
			prerequisites,
			appName,
			appUrl,
			secrets,
			previewDatabase,
			deploymentStorage,
			github,
			writeEnv,
			pushToVercel,
			seedPreviewTemplate,
		]);
	});

const prod = new Command("prod")
	.description("Set this project up for a real deployment.")
	.addOption(commonOptions.fresh)
	.addOption(commonOptions.cwd)
	.action(async (rawOptions) => {
		await runSetup("prod", rawOptions, [
			prerequisites,
			appName,
			appUrl,
			secrets,
			productionDatabase,
			deploymentStorage,
			github,
			writeEnv,
			pushToVercel,
			migrateAndSeed,
			deploy,
		]);
	});

const push = new Command("push")
	.description("Push an environment file to Vercel, without walking setup again.")
	.argument("<mode>", "dev, preview or prod")
	.addOption(commonOptions.cwd)
	.action(async (rawMode: string, rawOptions) => {
		const mode = z.enum(["dev", "preview", "prod"]).parse(rawMode);
		const { cwd } = setupSchema.parse(rawOptions);
		const file = path.resolve(cwd, ENV_FILE[mode]);

		intro(color.bgCyan(color.black(` push ${ENV_FILE[mode]} `)));

		if (!fs.existsSync(file)) {
			log.error(`No ${ENV_FILE[mode]} — run \`${scriptCommand(`setup:${mode}`)}\` first.`);
			process.exit(1);
		}

		const target = mode === "preview" ? "preview" : "production";
		const values = dotenvx.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
		const failures = await pushEnvironment(cwd, values, target);

		outro(
			failures.length === 0
				? `Redeploy for the new values to take effect — Vercel reads them when a build starts.`
				: "Some values were not set; see above.",
		);
		process.exit(failures.length === 0 ? 0 : 1);
	});

const cli = program
	.name("setup")
	.description("Set the project up for development, previews, or production.")
	.addCommand(dev)
	.addCommand(preview)
	.addCommand(prod)
	.addCommand(push);

cli.parse();
