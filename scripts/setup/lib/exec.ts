/**
 * Running other programs, and finding out which ones are there to run.
 */
import { spawnSync } from "node:child_process";
import { detect, resolveCommand, type Agent, type AgentName } from "package-manager-detector";

/** Windows resolves `pnpm` / `vercel` through a shim, which needs a shell. */
const SHELL = process.platform === "win32";

/**
 * Detected once, at import: every helper below is synchronous, and the answer
 * cannot change while a setup run is in progress.
 */
const detected = await detect({ cwd: process.cwd() });

/** The package manager this project is actually using. */
export const agent: Agent = detected?.agent ?? "pnpm";
/** Its bare name, for printing — `pnpm dev`, `npm run dev`. */
export const pm: AgentName = detected?.name ?? "pnpm";

/** How the local manager spells running a script — `pnpm dev`, `npm run dev`. */
export function scriptCommand(script: string): string {
	const resolved = resolveCommand(agent, "run", [script]);
	return resolved === null ? `${pm} run ${script}` : [resolved.command, ...resolved.args].join(" ");
}

/** Runs one of this project's package scripts, with its output on screen. */
export function runScript(script: string, env: Record<string, string> = {}): boolean {
	const resolved = resolveCommand(agent, "run", [script]);
	if (resolved === null) return false;

	const result = spawnSync(resolved.command, resolved.args, {
		stdio: "inherit",
		// The values may only just have been written to disk, so hand them over
		// directly rather than depending on something re-reading the .env.
		env: { ...process.env, ...env },
		shell: SHELL,
	});
	return result.status === 0;
}

export function installDependencies(): boolean {
	const resolved = resolveCommand(agent, "install", []);
	if (resolved === null) return false;

	const result = spawnSync(resolved.command, resolved.args, { stdio: "inherit", shell: SHELL });
	return result.status === 0;
}

/** Is this command on PATH? */
export function installed(command: string): boolean {
	const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
		stdio: "ignore",
		shell: SHELL,
	});
	return probe.status === 0;
}

/** Run a command and keep its output instead of showing it. */
export function capture(
	command: string,
	args: string[],
	env: Record<string, string> = {},
): { ok: boolean; out: string; err: string } {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: { ...process.env, ...env },
		shell: SHELL,
	});
	return {
		ok: result.status === 0,
		out: (result.stdout ?? "").trim(),
		err: (result.stderr ?? "").trim(),
	};
}

/** Run a command with its output on screen, optionally feeding it stdin. */
export function passthrough(
	command: string,
	args: string[],
	options: { input?: string; env?: Record<string, string> } = {},
): boolean {
	const result = spawnSync(command, args, {
		stdio: options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
		input: options.input,
		env: { ...process.env, ...options.env },
		shell: SHELL,
	});
	return result.status === 0;
}

/** Vite 7 needs 20.19+; anything older fails the build in a confusing way. */
export function nodeIsSupported(): boolean {
	const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
	return major > 20 || (major === 20 && minor >= 19);
}
