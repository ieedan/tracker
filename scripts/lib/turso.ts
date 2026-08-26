/**
 * The Turso platform API, over `fetch` and nothing else.
 *
 * Shared by `scripts/setup` (which has the Turso CLI to fall back on) and by
 * `scripts/preview-db.ts` (which runs inside a Vercel build, where the CLI is
 * not installed and cannot be).
 */
import { createHash } from "node:crypto";

const API = "https://api.turso.tech";

export type TursoAuth = {
	/** A platform API token — `turso auth api-tokens mint <name>`. */
	token: string;
	/** The organization slug — `turso org list`, or your username. */
	org: string;
};

export type TursoDatabase = {
	Name: string;
	Hostname: string;
	group: string;
	parent_name?: string;
};

class TursoError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
		method: string,
		path: string,
	) {
		super(`Turso ${method} ${path} failed with ${status}: ${body}`);
		this.name = "TursoError";
	}
}

async function request<T>(
	auth: TursoAuth,
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${auth.token}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const text = await response.text();
	if (!response.ok) throw new TursoError(response.status, text, method, path);
	return (text === "" ? {} : JSON.parse(text)) as T;
}

function organization(auth: TursoAuth): string {
	return `/v1/organizations/${encodeURIComponent(auth.org)}`;
}

/** The connection string `@libsql/client` wants, from what the API returns. */
export function databaseUrl(database: TursoDatabase): string {
	return `libsql://${database.Hostname}`;
}

export async function listDatabases(auth: TursoAuth): Promise<TursoDatabase[]> {
	const result = await request<{ databases: TursoDatabase[] }>(
		auth,
		"GET",
		`${organization(auth)}/databases`,
	);
	return result.databases ?? [];
}

export async function getDatabase(auth: TursoAuth, name: string): Promise<TursoDatabase | null> {
	try {
		const result = await request<{ database: TursoDatabase }>(
			auth,
			"GET",
			`${organization(auth)}/databases/${encodeURIComponent(name)}`,
		);
		return result.database ?? null;
	} catch (error) {
		if (error instanceof TursoError && error.status === 404) return null;
		throw error;
	}
}

/**
 * Creates a database, optionally as a copy of another one.
 *
 * `seedFrom` is what makes a preview deployment cheap: Turso copies the parent
 * at its current point in time, so the new database arrives already migrated
 * and already holding the demo workspace.
 */
export async function createDatabase(
	auth: TursoAuth,
	options: { name: string; group: string; seedFrom?: string },
): Promise<TursoDatabase> {
	const result = await request<{ database: TursoDatabase }>(
		auth,
		"POST",
		`${organization(auth)}/databases`,
		{
			name: options.name,
			group: options.group,
			...(options.seedFrom === undefined
				? {}
				: { seed: { type: "database", name: options.seedFrom } }),
		},
	);
	return result.database;
}

export async function deleteDatabase(auth: TursoAuth, name: string): Promise<void> {
	await request(auth, "DELETE", `${organization(auth)}/databases/${encodeURIComponent(name)}`);
}

/** A bearer token for one database. */
export async function createDatabaseToken(
	auth: TursoAuth,
	name: string,
	expiration = "never",
): Promise<string> {
	const result = await request<{ jwt: string }>(
		auth,
		"POST",
		`${organization(auth)}/databases/${encodeURIComponent(name)}/auth/tokens` +
			`?expiration=${encodeURIComponent(expiration)}&authorization=full-access`,
	);
	return result.jwt;
}

export async function listGroups(auth: TursoAuth): Promise<Array<{ name: string }>> {
	const result = await request<{ groups: Array<{ name: string }> }>(
		auth,
		"GET",
		`${organization(auth)}/groups`,
	);
	return result.groups ?? [];
}

/** Turso database names: lowercase letters, digits and dashes. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function toDatabaseName(input: string): string {
	return input
		.toLowerCase()
		.replaceAll(/[^a-z0-9-]+/g, "-")
		.replaceAll(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** The prefix every per-deployment database carries, so pruning can find them. */
export const PREVIEW_PREFIX = "preview-";

/**
 * A stable database name for one git branch.
 *
 * Stable so that redeploying a branch reuses its database rather than throwing
 * the state away; hashed so that two branches whose names differ only past the
 * length limit — `feat/a/very/long/…` — do not collide.
 */
export function previewDatabaseName(branch: string, limit = 40): string {
	const digest = createHash("sha256").update(branch).digest("hex").slice(0, 6);
	const suffix = `-${digest}`;
	const room = limit - PREVIEW_PREFIX.length - suffix.length;
	const slug = toDatabaseName(branch).slice(0, Math.max(1, room)).replace(/-+$/, "");
	return `${PREVIEW_PREFIX}${slug}${suffix}`;
}
