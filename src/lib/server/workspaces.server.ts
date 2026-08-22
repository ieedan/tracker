import { and, eq, inArray, lt, notInArray } from "drizzle-orm";
import type { WorkspaceDto } from "@/lib/types";
import { db, schema } from "./db/index.server";
import { type GithubOwner, getAccessToken, listOwners, listRepos } from "./github.server";

/**
 * Workspaces mirror GitHub owners, and membership is not stored: what a user
 * can reach is whatever GitHub says they belong to. Because that answer costs
 * an API call, it is cached per user for a short window.
 */

const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;

type Membership = { workspaceIds: Set<string>; fetchedAt: number };

const CACHE_KEY = Symbol.for("tracker:membership");
const holder = globalThis as { [CACHE_KEY]?: Map<string, Membership> };
const cache = (holder[CACHE_KEY] ??= new Map<string, Membership>());

/** Linear's out-of-the-box workflow, seeded into every new workspace. */
const DEFAULT_STATUSES = [
	{ name: "Backlog", category: "backlog", color: "#bec2c8" },
	{ name: "Todo", category: "unstarted", color: "#e2e2e2" },
	{ name: "In Progress", category: "started", color: "#f2c94c" },
	{ name: "In Review", category: "started", color: "#5e6ad2" },
	{ name: "Done", category: "completed", color: "#5e9e6e" },
	{ name: "Canceled", category: "canceled", color: "#95a2b3" },
] as const;

const DEFAULT_LABELS = [
	{ name: "Bug", color: "#eb5757" },
	{ name: "Feature", color: "#5e6ad2" },
	{ name: "Improvement", color: "#4cb782" },
	{ name: "Documentation", color: "#bb87fc" },
] as const;

export function toWorkspaceDto(row: typeof schema.workspace.$inferSelect): WorkspaceDto {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		avatarUrl: row.avatarUrl,
		type: row.type,
		prefix: row.prefix,
	};
}

/** `acme-web` → `ACM`. Short, uppercase, and stable for a given login. */
function derivePrefix(login: string): string {
	const letters = login.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return (letters.slice(0, 4) || "WS").padEnd(2, "X");
}

/** Creates the workspace if it is new, refreshes its name/avatar if it is not. */
async function upsertWorkspace(owner: GithubOwner): Promise<string> {
	const [existing] = await db
		.select()
		.from(schema.workspace)
		.where(eq(schema.workspace.githubId, owner.githubId))
		.limit(1);

	if (existing !== undefined) {
		if (
			existing.slug !== owner.login ||
			existing.name !== owner.name ||
			existing.avatarUrl !== owner.avatarUrl
		) {
			await db
				.update(schema.workspace)
				.set({ slug: owner.login, name: owner.name, avatarUrl: owner.avatarUrl })
				.where(eq(schema.workspace.id, existing.id));
		}
		return existing.id;
	}

	const [created] = await db
		.insert(schema.workspace)
		.values({
			githubId: owner.githubId,
			slug: owner.login,
			name: owner.name,
			avatarUrl: owner.avatarUrl,
			type: owner.type,
			prefix: derivePrefix(owner.login),
		})
		.returning();

	const workspaceId = created!.id;

	await db.insert(schema.status).values(
		DEFAULT_STATUSES.map((status, position) => ({ ...status, workspaceId, position })),
	);
	await db.insert(schema.label).values(
		DEFAULT_LABELS.map((label) => ({ ...label, workspaceId })),
	);

	return workspaceId;
}

/**
 * Pulls the user's owners and repos from GitHub and reconciles them into the
 * database. Runs on login and whenever the membership cache expires, so a repo
 * created on GitHub shows up here within five minutes.
 */
export async function syncFromGithub(userId: string): Promise<Set<string>> {
	const token = await getAccessToken(userId);
	if (token === null) return demoWorkspaces();

	const owners = await listOwners(token);
	const workspaceIds = new Map<number, string>();
	for (const owner of owners) {
		workspaceIds.set(owner.githubId, await upsertWorkspace(owner));
	}

	const repos = await listRepos(token);
	for (const repo of repos) {
		const workspaceId = workspaceIds.get(repo.ownerGithubId);
		// A repo the user collaborates on, owned by someone they don't belong to.
		// There is no workspace for it, so there is nothing to scope issues to.
		if (workspaceId === undefined) continue;

		await db
			.insert(schema.repo)
			.values({
				workspaceId,
				githubId: repo.githubId,
				name: repo.name,
				description: repo.description,
				isPrivate: repo.isPrivate,
			})
			.onConflictDoUpdate({
				target: schema.repo.githubId,
				set: { name: repo.name, description: repo.description, isPrivate: repo.isPrivate },
			});
	}

	// Repos deleted on GitHub (or no longer visible) stop being offered. Their
	// issues survive — `issue.repoId` is `set null` — so nothing is lost.
	const seen = repos.map((r) => r.githubId);
	const ids = [...workspaceIds.values()];
	if (ids.length > 0) {
		await db
			.delete(schema.repo)
			.where(
				seen.length > 0
					? and(
							inArray(schema.repo.workspaceId, ids),
							notInArray(schema.repo.githubId, seen),
						)
					: inArray(schema.repo.workspaceId, ids),
			);
	}

	return new Set(workspaceIds.values());
}

/** The workspace ids this user may read, refreshing from GitHub when stale. */
export async function membership(userId: string): Promise<Set<string>> {
	const cached = cache.get(userId);
	if (cached !== undefined && Date.now() - cached.fetchedAt < MEMBERSHIP_TTL_MS) {
		return cached.workspaceIds;
	}

	try {
		const workspaceIds = await syncFromGithub(userId);
		cache.set(userId, { workspaceIds, fetchedAt: Date.now() });
		return workspaceIds;
	} catch (error) {
		// GitHub being down or rate-limiting should not log everyone out. Serve
		// the stale set if there is one, and let it retry on the next request.
		if (cached !== undefined) return cached.workspaceIds;
		throw error;
	}
}

/**
 * Seeded workspaces are stored with a negative `githubId`, which no real GitHub
 * owner has. They are reachable by any signed-in user who has no GitHub account
 * — which, since GitHub is the only real way in, means the demo account.
 */
async function demoWorkspaces(): Promise<Set<string>> {
	const rows = await db
		.select({ id: schema.workspace.id })
		.from(schema.workspace)
		.where(lt(schema.workspace.githubId, 0));
	return new Set(rows.map((row) => row.id));
}

/** Drops the cached membership so the next request re-reads GitHub. */
export function invalidateMembership(userId: string): void {
	cache.delete(userId);
}

/** Every workspace the user belongs to, ordered with their personal one first. */
export async function listForUser(userId: string): Promise<WorkspaceDto[]> {
	const ids = [...(await membership(userId))];
	if (ids.length === 0) return [];

	const rows = await db.select().from(schema.workspace).where(inArray(schema.workspace.id, ids));

	return rows
		.sort((a, b) => {
			if (a.type !== b.type) return a.type === "User" ? -1 : 1;
			return a.slug.localeCompare(b.slug);
		})
		.map(toWorkspaceDto);
}
