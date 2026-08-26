/**
 * Linking the project to Vercel and pushing an environment to it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { capture, installed, passthrough } from "./exec.ts";

/**
 * kit writes `.vercel/output` (Build Output API). The CLI still offers Vite's
 * `dist` preset because of `vite.config.ts`; `vercel.json` overrides that, and
 * the linked project is patched so the dashboard matches.
 */
const SETTINGS = {
	framework: null,
	buildCommand: "pnpm build",
	devCommand: "pnpm dev",
	installCommand: "pnpm install",
	outputDirectory: ".vercel/output",
};

export type VercelTarget = "production" | "preview" | "development";

type ProjectLink = { orgId: string; projectId: string };

function linkFile(cwd: string): string {
	return resolve(cwd, ".vercel/project.json");
}

export function isInstalled(): boolean {
	return installed("vercel");
}

export function isLinked(cwd: string): boolean {
	return readLink(cwd) !== null;
}

function readLink(cwd: string): ProjectLink | null {
	const file = linkFile(cwd);
	if (!existsSync(file)) return null;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as ProjectLink;
		return parsed.orgId && parsed.projectId ? parsed : null;
	} catch {
		return null;
	}
}

function version(): [number, number, number] | null {
	const match = capture("vercel", ["--version"]).out.match(/(\d+)\.(\d+)\.(\d+)/);
	if (match === null) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(major: number, minor: number, patch: number): boolean {
	const found = version();
	if (found === null) return false;
	if (found[0] !== major) return found[0] > major;
	if (found[1] !== minor) return found[1] > minor;
	return found[2] >= patch;
}

function token(): string | undefined {
	if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;

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

async function patchOverHttp(link: ProjectLink, bearer: string): Promise<boolean> {
	const query = link.orgId.startsWith("team_") ? `?teamId=${encodeURIComponent(link.orgId)}` : "";
	try {
		const response = await fetch(
			`https://api.vercel.com/v9/projects/${encodeURIComponent(link.projectId)}${query}`,
			{
				method: "PATCH",
				headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
				body: JSON.stringify(SETTINGS),
			},
		);
		return response.ok;
	} catch {
		return false;
	}
}

/** Framework "Other" plus `pnpm build`, so git deploys pick up `.vercel/output`. */
async function configure(cwd: string): Promise<boolean> {
	// `vercel project update` landed in 54.21.1. Older CLIs treat an unknown
	// subcommand as `deploy <path>`, so this must not be probed blindly.
	if (atLeast(54, 21, 1)) {
		return passthrough("vercel", [
			"project",
			"update",
			"--framework",
			"other",
			"--build-command",
			SETTINGS.buildCommand,
			"--dev-command",
			SETTINGS.devCommand,
			"--install-command",
			SETTINGS.installCommand,
			"--output-directory",
			SETTINGS.outputDirectory,
		]);
	}

	const link = readLink(cwd);
	const bearer = token();
	if (link === null || bearer === undefined) return false;
	return patchOverHttp(link, bearer);
}

/** Links the directory if it is not linked, then fixes the project settings. */
export async function link(cwd: string): Promise<{ ok: boolean; configured: boolean }> {
	if (!isLinked(cwd) && !passthrough("vercel", ["link"])) return { ok: false, configured: false };
	return { ok: true, configured: await configure(cwd) };
}

/** Sets one environment variable on one target, replacing any current value. */
export function setEnv(
	key: string,
	value: string,
	target: VercelTarget,
): { ok: boolean; error: string } {
	// `--force` is what allows an overwrite; without it `env add` fails on a key
	// that already exists. The value goes over stdin rather than `--value` so it
	// does not sit in the process list.
	//
	// A `PUBLIC_` variable is inlined into the browser bundle, so it is not a
	// secret and Vercel refuses to store it as one — it has to be marked
	// non-sensitive explicitly, since the CLI's default is the opposite.
	const visibility = key.startsWith("PUBLIC_") ? ["--no-sensitive", "--visibility", "config"] : [];
	const added = spawnSync("vercel", ["env", "add", key, target, "--force", ...visibility], {
		input: value,
		stdio: ["pipe", "pipe", "pipe"],
		encoding: "utf8",
	});
	if (added.status === 0) return { ok: true, error: "" };

	const output = `${added.stdout ?? ""}${added.stderr ?? ""}`;
	const message = output.match(/"message":\s*"([^"]+)"/)?.[1] ?? output.split("\n").at(-2) ?? "";
	return { ok: false, error: message.trim() };
}

export function deploy(production: boolean): boolean {
	const args = ["deploy", "--prebuilt"];
	if (production) args.push("--prod");
	return passthrough("vercel", args);
}
