/**
 * The Turso CLI, wrapped.
 *
 * Setup drives the CLI rather than the platform API because it is already
 * signed in on a developer's machine — creating the database outright beats
 * asking someone to copy two long strings out of a dashboard.
 */
import { capture, installed, passthrough } from "./exec.ts";

export const INSTALL_COMMAND =
	process.platform === "win32"
		? "irm get.tur.so/install.ps1 | iex"
		: "curl -sSfL https://get.tur.so/install.sh | bash";

export function isInstalled(): boolean {
	return installed("turso");
}

/** Runs Turso's own installer. Returns whether `turso` is on PATH afterwards. */
export function install(): boolean {
	const shell = process.platform === "win32" ? "powershell" : "sh";
	const args =
		process.platform === "win32" ? ["-Command", INSTALL_COMMAND] : ["-c", INSTALL_COMMAND];
	passthrough(shell, args);
	return isInstalled();
}

export function whoami(): string | null {
	const result = capture("turso", ["auth", "whoami"]);
	return result.ok && result.out !== "" ? result.out : null;
}

export function login(): boolean {
	passthrough("turso", ["auth", "login"]);
	return whoami() !== null;
}

/** Skips the header row of the CLI's tables. */
function rows(output: string): string[][] {
	return output
		.split("\n")
		.slice(1)
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => line.split(/\s{2,}|\t/).map((cell) => cell.trim()));
}

/** Organization slugs, the current one first. */
export function organizations(): string[] {
	const result = capture("turso", ["org", "list"]);
	if (!result.ok) return [];

	const slugs = rows(result.out)
		.map((row) => row[1] ?? "")
		.filter((slug) => slug !== "");

	const current = slugs.find((slug) => slug.endsWith("(current)"));
	const cleaned = slugs.map((slug) => slug.replace(/\s*\(current\)$/, ""));
	if (current === undefined) return cleaned;

	const name = current.replace(/\s*\(current\)$/, "");
	return [name, ...cleaned.filter((slug) => slug !== name)];
}

export function groups(): string[] {
	const result = capture("turso", ["group", "list"]);
	if (!result.ok) return [];
	return rows(result.out)
		.map((row) => row[0] ?? "")
		.filter((name) => name !== "");
}

export function createGroup(name: string): boolean {
	return passthrough("turso", ["group", "create", name]);
}

export function databases(): Array<{ name: string; group: string; url: string }> {
	const result = capture("turso", ["db", "list"]);
	if (!result.ok) return [];
	return rows(result.out)
		.filter((row) => (row[0] ?? "") !== "")
		.map((row) => ({ name: row[0] ?? "", group: row[2] ?? "", url: row[3] ?? "" }));
}

export function exists(name: string): boolean {
	return databases().some((database) => database.name === name);
}

export function createDatabase(name: string, group?: string): boolean {
	const args = ["db", "create", name, "--wait"];
	if (group !== undefined && group !== "") args.push("--group", group);
	return passthrough("turso", args);
}

export function databaseUrl(name: string): string | null {
	const result = capture("turso", ["db", "show", name, "--url"]);
	return result.ok && result.out !== "" ? result.out : null;
}

export function databaseToken(name: string): string | null {
	const result = capture("turso", ["db", "tokens", "create", name]);
	return result.ok && result.out !== "" ? result.out : null;
}

/**
 * A non-expiring platform token for the preview build to use, scoped to one
 * organization and one group — so a leaked Vercel variable cannot reach
 * databases outside it.
 */
export function mintApiToken(name: string, org: string, group: string): string | null {
	const result = capture("turso", [
		"auth",
		"api-tokens",
		"mint",
		name,
		"--org",
		org,
		"--group",
		group,
		"--full-access",
	]);
	if (!result.ok) return null;

	// The CLI wraps the token in a sentence; a JWT is the only thing on the
	// output that looks like this.
	const match = `${result.out}\n${result.err}`.match(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/);
	return match?.[0] ?? null;
}

export function apiTokenNames(): string[] {
	const result = capture("turso", ["auth", "api-tokens", "list"]);
	if (!result.ok) return [];
	return rows(result.out)
		.map((row) => row[0] ?? "")
		.filter((name) => name !== "");
}

export function revokeApiToken(name: string): boolean {
	return capture("turso", ["auth", "api-tokens", "revoke", name]).ok;
}
