/**
 * The steps every mode shares.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as v from "valibot";
import { publicEnvSchema, serverEnvSchema } from "../../../src/lib/env.schema.ts";
import { ENV_FILE, KNOWN_KEYS, display, render, write } from "../lib/env-file.ts";
import { installDependencies, nodeIsSupported, runScript, scriptCommand } from "../lib/exec.ts";
import { askConfirm, askEnv, color, fail, ok, summary, warn } from "../lib/ui.ts";
import { existingEnv, filled, origin, type Step, type StepContext } from "../lib/types.ts";

/** The answers this mode's own env file already holds, if it has one. */
export function previous(ctx: StepContext): Record<string, string> {
	return existingEnv(ctx, ENV_FILE[ctx.mode]);
}

/**
 * A value this run has already collected, or failing that one from an env file
 * on disk, preferring this mode's own.
 *
 * What the run collected wins: a resumed draft holds answers, generated
 * secrets and minted credentials that are not written anywhere yet, and asking
 * for them again would mean a second Turso token and a signing secret that
 * signs everyone out.
 */
export function borrow(ctx: StepContext, key: string, ...files: string[]): string {
	const collected = ctx.data.values[key];
	if (filled(collected)) return collected;

	const order = [ENV_FILE[ctx.mode], ...files];
	for (const file of order) {
		const value = ctx.env?.[file]?.[key];
		if (filled(value)) return value;
	}
	return "";
}

export function set(ctx: StepContext, values: Record<string, string>): void {
	Object.assign(ctx.data.values, values);
}

const PROD_URL = v.pipe(
	v.string(),
	v.url("must be an absolute URL"),
	v.check((value) => value.startsWith("https://"), "a deployment should be served over https"),
);

export const prerequisites: Step = {
	name: "prerequisites",
	async run(ctx) {
		if (!nodeIsSupported()) {
			fail(`Node ${process.versions.node} — this project needs 20.19 or newer.`);
			process.exit(1);
		}

		if (existsSync(resolve(ctx.options.cwd, "node_modules"))) {
			ok(`Node ${process.versions.node}, dependencies installed`);
			return;
		}

		if (!installDependencies()) {
			fail("Installing dependencies failed.");
			process.exit(1);
		}
		ok("dependencies installed");
	},
};

export const appName: Step = {
	name: "app name",
	async run(ctx) {
		const value = await askEnv({
			key: "PUBLIC_APP_NAME",
			hint: "Shown in the browser tab.",
			schema: publicEnvSchema.PUBLIC_APP_NAME,
			initial: borrow(ctx, "PUBLIC_APP_NAME", ".env.production", ".env") || "tracker",
		});
		set(ctx, { PUBLIC_APP_NAME: value });
	},
};

export const appUrl: Step = {
	name: "app url",
	async run(ctx) {
		if (ctx.mode === "dev") {
			const value = await askEnv({
				key: "BETTER_AUTH_URL",
				hint: "The origin you open the app at.",
				schema: serverEnvSchema.BETTER_AUTH_URL,
				initial: previous(ctx).BETTER_AUTH_URL ?? "http://localhost:5173",
			});
			set(ctx, { BETTER_AUTH_URL: origin(value) });
			return;
		}

		if (ctx.mode === "preview") {
			const value = await askEnv({
				key: "BETTER_AUTH_URL",
				hint: "A fallback — each preview overrides it with its own branch URL.",
				schema: PROD_URL,
				initial: borrow(ctx, "BETTER_AUTH_URL", ".env.production"),
			});
			set(ctx, { BETTER_AUTH_URL: origin(value) });
			return;
		}

		const value = await askEnv({
			key: "BETTER_AUTH_URL",
			hint: "The URL people will open. Sign-in fails if this is not the real one.",
			schema: PROD_URL,
			initial: previous(ctx).BETTER_AUTH_URL ?? "",
		});
		set(ctx, { BETTER_AUTH_URL: origin(value) });
	},
};

export const secrets: Step = {
	name: "secrets",
	async run(ctx) {
		const authSecret = borrow(ctx, "BETTER_AUTH_SECRET");
		const cronSecret = borrow(ctx, "CRON_SECRET");

		set(ctx, {
			BETTER_AUTH_SECRET: filled(authSecret) ? authSecret : randomBytes(32).toString("base64"),
			CRON_SECRET: filled(cronSecret) ? cronSecret : randomBytes(24).toString("base64url"),
		});

		ok(
			filled(authSecret)
				? "kept the existing signing and cron secrets"
				: "generated a signing secret and a cron secret",
		);
	},
};

export const writeEnv: Step = {
	name: "write env file",
	async run(ctx) {
		const values = ctx.data.values;
		summary(
			`${ENV_FILE[ctx.mode]}`,
			KNOWN_KEYS.filter((key) => key in values).map((key) => [
				key,
				display(key, values[key] ?? ""),
			]),
		);

		if (!(await askConfirm(`Write ${ENV_FILE[ctx.mode]}?`, true))) {
			warn("Nothing written.");
			process.exit(0);
		}

		const file = write(ctx.options.cwd, ctx.mode, render(ctx.mode, values, previous(ctx)));
		ctx.data.choices.wrote = file;
		ok(`wrote ${file}`);
	},
};

/**
 * Migrating and seeding, last and behind a confirmation — they are the two
 * steps here that change data rather than configuration.
 */
export const migrateAndSeed: Step = {
	name: "migrate and seed",
	async run(ctx) {
		const values = ctx.data.values;
		const target = values.DATABASE_URL ?? "";

		// Nothing to migrate in preview: the template database is set up by its
		// own step, and each deployment branches from it at build time.
		if (ctx.mode === "preview") return;

		if (ctx.mode !== "dev") {
			warn(`The next step writes to ${color.bold(target)}.`);
		}

		if (await askConfirm("Apply database migrations?", ctx.mode === "dev")) {
			if (runScript("db:migrate", values)) {
				ctx.data.choices.migrated = true;
				ok("migrations applied");
			} else {
				fail(`failed — retry with \`${scriptCommand("db:migrate")}\``);
			}
		} else {
			warn(`The app will not run until \`${scriptCommand("db:migrate")}\` has been applied.`);
		}

		if (ctx.data.choices.migrated !== true) return;

		const isFresh = !filled(previous(ctx).DATABASE_URL);
		if (await askConfirm("Seed a demo workspace?", ctx.mode === "dev" && isFresh)) {
			if (runScript("db:seed", values)) {
				ctx.data.choices.seeded = true;
				ok("seeded — sign in as demo@tracker.dev / password123");
			} else {
				fail(`failed — retry with \`${scriptCommand("db:seed")}\``);
			}
		}
	},
};
