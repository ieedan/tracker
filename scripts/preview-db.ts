/**
 * Gives every Vercel preview deployment a database of its own.
 *
 * On a preview build this branches `TURSO_PREVIEW_PARENT` — a template database
 * that setup migrated and seeded once — into `preview-<branch>-<hash>`, applies
 * any migrations the branch has added since, and hands the connection back to
 * the build.
 *
 * The name is derived from the branch rather than the deployment, so pushing
 * again reuses the same database instead of discarding the state a reviewer
 * built up. `pnpm preview:prune` removes the ones whose branch is gone.
 *
 * Env vars are baked into the build by kit's `defineEnv`, so this has to run
 * *before* `vite build` and in the same environment — which is what
 * `scripts/build.ts` arranges.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	createDatabase,
	createDatabaseToken,
	databaseUrl,
	getDatabase,
	previewDatabaseName,
	type TursoAuth,
} from "./lib/turso.ts";

/** What a preview build needs before it can provision anything. */
type PreviewConfig = {
	auth: TursoAuth;
	/** The database every preview is copied from. */
	parent: string;
	/** Explicit group, or the parent's own. */
	group: string | undefined;
	branch: string;
};

function readConfig(): PreviewConfig | null {
	const token = process.env.TURSO_API_TOKEN ?? "";
	const org = process.env.TURSO_ORG ?? "";
	const parent = process.env.TURSO_PREVIEW_PARENT ?? "";
	const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";

	if (token === "" || org === "" || parent === "" || branch === "") return null;
	return {
		auth: { token, org },
		parent,
		group: process.env.TURSO_GROUP === "" ? undefined : process.env.TURSO_GROUP,
		branch,
	};
}

/**
 * Every origin this deployment answers on.
 *
 * There are two: the branch URL, stable across redeploys of a branch, and the
 * deployment URL, which changes every push and is the one Vercel links from
 * the pull request. Both have to be trusted — a visitor lands on whichever
 * link they followed, and better-auth rejects a sign-in from any origin it was
 * not told about.
 */
function previewOrigins(): { baseURL: string | null; trusted: string[] } {
	const hosts = [process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL];
	const trusted = [...new Set(hosts.filter((host) => !!host).map((host) => `https://${host}`))];
	// The branch URL leads, so the stable one is what absolute links are built
	// from when both exist.
	return { baseURL: trusted[0] ?? null, trusted };
}

function drizzleKit(): string {
	const binary = process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit";
	return resolve(process.cwd(), "node_modules/.bin", binary);
}

function migrate(env: Record<string, string>): void {
	const binary = drizzleKit();
	if (!existsSync(binary)) throw new Error(`drizzle-kit is not installed at ${binary}`);

	const result = spawnSync(binary, ["migrate"], {
		stdio: "inherit",
		env: { ...process.env, ...env },
		shell: process.platform === "win32",
	});
	if (result.status !== 0)
		throw new Error("drizzle-kit migrate failed against the preview database");
}

/**
 * Environment overrides for this build, or `{}` when this is not a preview.
 *
 * @throws when a preview *is* configured but provisioning fails — carrying on
 * would point the deployment at whatever `DATABASE_URL` is set project-wide,
 * which for a preview is the shared template it was branching away from.
 */
export async function provisionPreviewDatabase(): Promise<Record<string, string>> {
	if (process.env.VERCEL_ENV !== "preview") return {};

	const config = readConfig();
	if (config === null) {
		console.log(
			"preview: TURSO_API_TOKEN, TURSO_ORG and TURSO_PREVIEW_PARENT are not all set — " +
				"this deployment will use the DATABASE_URL configured on the project.",
		);
		return {};
	}

	const { auth, parent, branch } = config;
	const name = previewDatabaseName(branch);

	let database = await getDatabase(auth, name);
	if (database === null) {
		const template = await getDatabase(auth, parent);
		if (template === null) {
			throw new Error(`preview: the template database ${parent} does not exist`);
		}
		console.log(`preview: creating ${name} from ${parent}`);
		database = await createDatabase(auth, {
			name,
			group: config.group ?? template.group,
			seedFrom: parent,
		});
	} else {
		console.log(`preview: reusing ${name}`);
	}

	const overrides: Record<string, string> = {
		DATABASE_URL: databaseUrl(database),
		DATABASE_AUTH_TOKEN: await createDatabaseToken(auth, name),
	};

	const { baseURL, trusted } = previewOrigins();
	if (baseURL !== null) overrides.BETTER_AUTH_URL = baseURL;
	if (trusted.length > 0) overrides.BETTER_AUTH_TRUSTED_ORIGINS = trusted.join(",");

	// The copy carries the template's migration history, so this applies only
	// what the branch has added on top of it.
	migrate(overrides);
	console.log(`preview: ${name} ready at ${overrides.DATABASE_URL}`);

	return overrides;
}

// Runnable on its own, mostly to check the wiring without a full build.
if (import.meta.url === `file://${process.argv[1]}`) {
	const overrides = await provisionPreviewDatabase();
	for (const key of Object.keys(overrides)) console.log(key);
}
