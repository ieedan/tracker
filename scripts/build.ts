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
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

// A production deployment migrates its database the same way a preview does,
// just without the provisioning: pending migrations apply before the build
// bakes the connection in. Drizzle records what it has applied in the database
// itself, so a redeploy with nothing new is a no-op — but a failed migration
// fails the build, which means schema changes have to stay backward-compatible
// (the previous deployment keeps serving until this one goes live).
if (process.env.VERCEL_ENV === "production") {
	run(bin("drizzle-kit"), ["migrate"], {});
}

run(bin("vite"), ["build"], overrides);

/**
 * The JSON-Schema converter has to be *in* the deployed function.
 *
 * Kit reaches it through `$implement/schema-converters`, a virtual module the
 * build fills with the converter packages that resolve — so whether it ships is
 * decided here and is invisible everywhere else. Dev and `verify:mcp` always
 * resolve it from `node_modules` and look fine either way; when it is missing
 * from the bundle, `tools/list` is the thing that breaks, in production, after
 * a deploy. That was implementjs ENG-29, where every MCP tool went out as a
 * bare `{"type":"object"}` — a server the model can list and cannot call.
 *
 * Kit 0.0.18 throws instead of serving empty schemas, which turns that into a
 * 500 rather than a silent lie. This is what keeps it from getting that far.
 */
function assertConvertersBundled(): void {
	const functions = ".vercel/output/functions";
	let names: string[];
	try {
		names = readdirSync(functions);
	} catch {
		// A different adapter, or a build that writes somewhere else. Nothing to
		// assert against rather than a failure invented from a missing directory.
		return;
	}
	for (const name of names) {
		const dir = join(functions, name);
		const chunks = join(dir, "chunks");
		const files = [
			join(dir, "index.js"),
			...(() => {
				try {
					return readdirSync(chunks).map((file) => join(chunks, file));
				} catch {
					return [];
				}
			})(),
		];
		const bundled = files.some((file) => {
			try {
				return readFileSync(file, "utf8").includes('"@valibot/to-json-schema":');
			} catch {
				return false;
			}
		});
		if (!bundled) {
			console.error(
				`\nbuild: ${name} does not carry the "@valibot/to-json-schema" converter, so every MCP tool would ship an empty inputSchema (implementjs ENG-29).\n` +
					"Check that the package still resolves at build time — kit only bundles the converters it can find.\n",
			);
			process.exit(1);
		}
	}
}

assertConvertersBundled();

run(bin("tsx"), ["scripts/vercel-cron.ts"], overrides);
