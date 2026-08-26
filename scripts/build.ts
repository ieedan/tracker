/**
 * The project's build, with one thing in front of it.
 *
 * `defineEnv` bakes the environment into the bundle at build time, so a preview
 * deployment's database has to exist before `vite build` starts and has to be
 * in the same environment. This provisions it, then runs the build with the
 * connection it produced.
 *
 * Nothing happens here outside a Vercel preview: `pnpm build` locally, and a
 * production deployment, are `vite build` and the cron step exactly as before.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { provisionPreviewDatabase } from "./preview-db.ts";

const SHELL = process.platform === "win32";

function bin(name: string): string {
	return resolve(process.cwd(), "node_modules/.bin", SHELL ? `${name}.cmd` : name);
}

function run(command: string, args: string[], env: Record<string, string>): void {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env: { ...process.env, ...env },
		shell: SHELL,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const overrides = await provisionPreviewDatabase();

run(bin("vite"), ["build"], overrides);
run(bin("tsx"), ["scripts/vercel-cron.ts"], overrides);
