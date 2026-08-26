/**
 * Where the data lives, per mode.
 *
 * Development defaults to a local SQLite file; a deployment needs a hosted
 * libSQL database, which the Turso CLI can create outright rather than making
 * anyone copy a URL and a token out of a dashboard.
 */
import * as v from "valibot";
import { serverEnvSchema } from "../../../src/lib/env.schema.ts";
import { NAME_PATTERN, toDatabaseName } from "../../lib/turso.ts";
import { runScript, scriptCommand } from "../lib/exec.ts";
import * as turso from "../lib/turso-cli.ts";
import {
	askConfirm,
	askEnv,
	askSelect,
	color,
	fail,
	instructions,
	ok,
	required,
	warn,
} from "../lib/ui.ts";
import { filled, type Step, type StepContext } from "../lib/types.ts";
import { borrow, previous, set } from "./common.ts";

const NAME_SCHEMA = v.pipe(
	v.string(),
	v.regex(NAME_PATTERN, "lowercase letters, digits and dashes"),
);

/** Signs in to Turso, installing the CLI first if it is missing. */
async function ready(): Promise<boolean> {
	if (!turso.isInstalled()) {
		warn("The Turso CLI is not installed; it can create the database for you.");
		if (!(await askConfirm(`Install it now?  ${color.dim(turso.INSTALL_COMMAND)}`, true))) {
			return false;
		}
		if (!turso.install()) {
			warn("Not on PATH yet — reopen your shell afterwards.");
			return false;
		}
	}

	const who = turso.whoami();
	if (who !== null) {
		ok(`signed in to Turso as ${who}`);
		return true;
	}

	warn("Signing in to Turso — a browser window will open.");
	if (!turso.login()) return false;
	ok(`signed in to Turso as ${turso.whoami()}`);
	return true;
}

/** The last resort: the two values a Turso database page shows. */
async function askByHand(existing: {
	url: string;
	token: string;
}): Promise<{ DATABASE_URL: string; DATABASE_AUTH_TOKEN: string }> {
	instructions({
		title: "Turso",
		url: "https://app.turso.tech",
		steps: [
			"Create a database.",
			"Its page shows the URL under Connect, and a Create Token button beside it.",
		],
	});

	return {
		DATABASE_URL: await askEnv({
			key: "DATABASE_URL",
			hint: "Starts libsql://.",
			schema: serverEnvSchema.DATABASE_URL,
			initial: existing.url,
		}),
		DATABASE_AUTH_TOKEN: await askEnv({
			key: "DATABASE_AUTH_TOKEN",
			hint: "The database token.",
			schema: required("a hosted database needs a token"),
			initial: existing.token,
			secret: true,
		}),
	};
}

/** Creates the database if it is not there, then reads back its URL and token. */
async function provision(
	name: string,
	group: string | undefined,
	existing: { url: string; token: string },
): Promise<{ DATABASE_URL: string; DATABASE_AUTH_TOKEN: string } | null> {
	if (turso.exists(name)) {
		ok(`${name} already exists`);
	} else if (turso.createDatabase(name, group)) {
		ok(`created ${name}`);
	} else {
		warn(`Could not create ${name}.`);
		return await askByHand(existing);
	}

	const url = turso.databaseUrl(name);
	const token = turso.databaseToken(name);
	if (url === null || token === null) {
		warn("Could not read the database URL and token back.");
		return await askByHand(existing);
	}

	return { DATABASE_URL: url, DATABASE_AUTH_TOKEN: token };
}

async function hostedDatabase(ctx: StepContext, defaultName: string): Promise<void> {
	const existing = {
		url: borrow(ctx, "DATABASE_URL").startsWith("file:") ? "" : borrow(ctx, "DATABASE_URL"),
		token: borrow(ctx, "DATABASE_AUTH_TOKEN"),
	};

	if (!(await ready())) {
		set(ctx, await askByHand(existing));
		ctx.data.choices.database = "turso";
		return;
	}

	const name = await askEnv({
		key: "Database name",
		hint: "Created if it does not exist yet.",
		schema: NAME_SCHEMA,
		initial: defaultName,
	});

	const values = await provision(name, undefined, existing);
	if (values !== null) set(ctx, values);
	ctx.data.choices.database = "turso";
	ctx.data.choices.tursoDatabase = name;
}

export const developmentDatabase: Step = {
	name: "database",
	async run(ctx) {
		const remembered = previous(ctx).DATABASE_URL ?? "";
		const wasRemote = filled(remembered) && !remembered.startsWith("file:");

		const where = await askSelect(
			"Where should the database live?",
			[
				{ value: "local" as const, label: "Local SQLite file", hint: "no account needed" },
				{ value: "turso" as const, label: "Turso", hint: "hosted libSQL" },
			],
			wasRemote ? "turso" : "local",
		);

		if (where === "local") {
			const url = await askEnv({
				key: "DATABASE_URL",
				hint: "Path to the SQLite file, as a file: URL.",
				schema: serverEnvSchema.DATABASE_URL,
				initial: wasRemote || remembered === "" ? "file:./local.db" : remembered,
			});
			set(ctx, { DATABASE_URL: url, DATABASE_AUTH_TOKEN: "" });
			ctx.data.choices.database = "local";
			return;
		}

		await hostedDatabase(ctx, toDatabaseName(ctx.data.values.PUBLIC_APP_NAME ?? "tracker"));
	},
};

export const productionDatabase: Step = {
	name: "database",
	async run(ctx) {
		await hostedDatabase(ctx, toDatabaseName(ctx.data.values.PUBLIC_APP_NAME ?? "tracker"));
	},
};

/**
 * Previews do not share one database — each deployment branches its own from a
 * template. This sets that template up, and mints the credentials the build
 * needs to do the branching.
 */
export const previewDatabase: Step = {
	name: "preview databases",
	async run(ctx) {
		const app = toDatabaseName(ctx.data.values.PUBLIC_APP_NAME ?? "tracker");

		if (!(await ready())) {
			warn("Preview databases need the Turso CLI signed in. Re-run this once it is.");
			process.exit(1);
		}

		// --- organization -----------------------------------------------------
		const orgs = turso.organizations();
		const org =
			orgs.length > 1
				? await askSelect(
						"Which Turso organization?",
						orgs.map((slug) => ({ value: slug, label: slug })),
						borrow(ctx, "TURSO_ORG") || orgs[0],
					)
				: ((borrow(ctx, "TURSO_ORG") || orgs[0]) ??
					(await askEnv({
						key: "TURSO_ORG",
						hint: "Your organization slug — `turso org list`.",
						schema: required("name the organization"),
					})));

		// --- group ------------------------------------------------------------
		// A group of their own keeps the token the build carries away from
		// whatever else the organization holds.
		const existingGroups = turso.groups();
		const remembered = borrow(ctx, "TURSO_GROUP");
		const groupChoice = await askSelect(
			"Which group should preview databases live in?",
			[
				...(existingGroups.includes("preview")
					? []
					: [{ value: "__new__", label: "preview", hint: "create a group of their own" }]),
				...existingGroups.map((name) => ({ value: name, label: name })),
			],
			remembered !== "" && existingGroups.includes(remembered)
				? remembered
				: existingGroups.includes("preview")
					? "preview"
					: "__new__",
		);

		let group = groupChoice;
		if (groupChoice === "__new__") {
			if (turso.createGroup("preview")) {
				group = "preview";
				ok("created the preview group");
			} else {
				group = existingGroups[0] ?? "default";
				warn(`Could not create it — previews will share the ${group} group.`);
			}
		}

		// --- template ---------------------------------------------------------
		const parent = await askEnv({
			key: "Template database",
			hint: "Every preview is copied from this one.",
			schema: NAME_SCHEMA,
			initial: borrow(ctx, "TURSO_PREVIEW_PARENT") || `${app}-preview-template`,
		});

		const values = await provision(parent, group, {
			url: borrow(ctx, "DATABASE_URL").startsWith("file:") ? "" : borrow(ctx, "DATABASE_URL"),
			token: borrow(ctx, "DATABASE_AUTH_TOKEN"),
		});
		if (values !== null) set(ctx, values);

		// --- the token the build uses ------------------------------------------
		let apiToken = borrow(ctx, "TURSO_API_TOKEN");
		if (filled(apiToken)) {
			ok("kept the existing Turso API token");
		} else {
			const tokenName = `${app}-preview`;
			if (turso.apiTokenNames().includes(tokenName)) {
				warn(`A Turso API token named ${tokenName} exists, but its value cannot be read back.`);
				if (await askConfirm(`Revoke ${tokenName} and mint a new one?`, true)) {
					turso.revokeApiToken(tokenName);
				}
			}
			const minted = turso.mintApiToken(tokenName, org, group);
			if (minted === null) {
				warn("Minting a token failed.");
				apiToken = await askEnv({
					key: "TURSO_API_TOKEN",
					hint: `From \`turso auth api-tokens mint ${tokenName} --org ${org} --group ${group} --full-access\`.`,
					schema: required("paste the token"),
					secret: true,
				});
			} else {
				apiToken = minted;
				ok(`minted a Turso API token scoped to ${org}/${group}`);
			}
		}

		set(ctx, {
			TURSO_API_TOKEN: apiToken,
			TURSO_ORG: org,
			TURSO_GROUP: group,
			TURSO_PREVIEW_PARENT: parent,
		});
		ctx.data.choices.database = "turso";
		ctx.data.choices.tursoDatabase = parent;
	},
};

/**
 * Migrating and seeding the template, last: every preview is copied from it, so
 * what goes in here is what every reviewer opens the app to.
 */
export const seedPreviewTemplate: Step = {
	name: "seed the template",
	async run(ctx) {
		const values = ctx.data.values;
		const parent = values.TURSO_PREVIEW_PARENT ?? "";
		warn(`The next step writes to ${color.bold(parent)}.`);

		if (await askConfirm(`Apply migrations to ${parent}?`, true)) {
			if (runScript("db:migrate", values)) {
				ctx.data.choices.migrated = true;
				ok("migrations applied");
			} else {
				fail(`failed — retry with \`${scriptCommand("db:migrate")}\``);
				return;
			}
		} else {
			warn("Previews will be copies of an empty database until migrations are applied.");
			return;
		}

		if (await askConfirm(`Seed a demo workspace into ${parent}?`, true)) {
			if (runScript("db:seed", values)) {
				ctx.data.choices.seeded = true;
				ok("seeded — every preview starts with demo@tracker.dev / password123");
			} else {
				fail(`failed — retry with \`${scriptCommand("db:seed")}\``);
			}
		}
	},
};
