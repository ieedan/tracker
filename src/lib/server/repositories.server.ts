/**
 * Repositories, their file index, and the pull requests attached to issues.
 *
 * Every provider call goes through the adapter registry, so nothing in here
 * knows it is talking to GitHub.
 */
import { error } from "@implementjs/kit/server";
import { and, asc, count, eq, inArray, like, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { GitProviderId } from "@/lib/domain/providers";
import type { PullRequest, Repository } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { providerFor } from "./providers/index.server";
import { providerInstallation, pullRequest, repository, repositoryFile } from "./schema.server";
import { iso } from "./serialize.server";

type RepositoryRow = typeof repository.$inferSelect;
type PullRequestRow = typeof pullRequest.$inferSelect;

/** How many paths one repository may contribute to the index. */
const MAX_INDEXED_FILES = 50_000;
/** SQLite takes a bounded number of bound parameters per statement. */
const INSERT_CHUNK = 500;

export function toRepository(row: RepositoryRow): Repository {
	return {
		id: row.id,
		provider: row.provider,
		owner: row.owner,
		name: row.name,
		fullName: `${row.owner}/${row.name}`,
		defaultBranch: row.defaultBranch,
		private: row.private,
		url: row.url,
		description: row.description,
		index: {
			state: row.indexState,
			ref: row.indexRef,
			fileCount: row.indexedFileCount,
			truncated: row.indexTruncated,
			indexedAt: iso(row.indexedAt),
			error: row.indexError,
		},
		createdAt: row.createdAt.toISOString(),
	};
}

export function toPullRequest(row: PullRequestRow, repo: RepositoryRow): PullRequest {
	return {
		id: row.id,
		number: row.number,
		title: row.title,
		state: row.state,
		url: row.url,
		authorLogin: row.authorLogin,
		repository: { id: repo.id, fullName: `${repo.owner}/${repo.name}` },
		syncedAt: iso(row.syncedAt),
		createdAt: row.createdAt.toISOString(),
	};
}

/** A snapshot older than this is refetched when somebody looks at the issue. */
const PULL_REQUEST_STALE_MS = 5 * 60_000;

/**
 * Re-reads a pull request from the provider when the snapshot has aged.
 *
 * State is stored rather than fetched per render, so an issue list is one
 * query rather than a burst of API calls — but a stored state goes stale, and
 * an issue still reading "Open" after its pull request merged is worse than
 * slightly slow. This refreshes on the detail page only, where there is exactly
 * one to check, and treats a provider failure as "keep what we had": a GitHub
 * outage should not blank the link.
 */
export async function refreshPullRequest(
	row: PullRequestRow,
	repo: RepositoryRow,
): Promise<PullRequestRow> {
	const age = row.syncedAt === null ? Infinity : Date.now() - row.syncedAt.getTime();
	if (age < PULL_REQUEST_STALE_MS) return row;

	try {
		const provider = providerFor(repo.provider);
		const remote = await provider.getPullRequest(
			await installationFor(repo),
			{ owner: repo.owner, name: repo.name },
			row.number,
		);
		if (remote === null) {
			// Deleted, or the installation lost sight of it. Note that we looked, so
			// this does not retry on every single page view.
			await db.update(pullRequest).set({ syncedAt: new Date() }).where(eq(pullRequest.id, row.id));
			return { ...row, syncedAt: new Date() };
		}

		const patch = {
			title: remote.title,
			state: remote.state,
			url: remote.url,
			authorLogin: remote.authorLogin,
			remoteUpdatedAt: new Date(remote.updatedAt),
			syncedAt: new Date(),
		};
		await db.update(pullRequest).set(patch).where(eq(pullRequest.id, row.id));
		return { ...row, ...patch };
	} catch {
		return row;
	}
}

/** The pull request on an issue, refreshed if the snapshot has aged. */
export async function pullRequestForIssue(issueId: string): Promise<PullRequest | null> {
	const rows = await db
		.select({ pull: pullRequest, repo: repository })
		.from(pullRequest)
		.innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
		.where(eq(pullRequest.issueId, issueId))
		.limit(1);

	const row = rows[0];
	if (row === undefined) return null;
	return toPullRequest(await refreshPullRequest(row.pull, row.repo), row.repo);
}

export async function listRepositories(workspaceId: string): Promise<Repository[]> {
	const rows = await db
		.select()
		.from(repository)
		.where(eq(repository.workspaceId, workspaceId))
		.orderBy(asc(repository.owner), asc(repository.name));
	return rows.map(toRepository);
}

/** The row, scoped to the workspace, or a 404. */
export async function requireRepository(workspaceId: string, id: string): Promise<RepositoryRow> {
	const rows = await db
		.select()
		.from(repository)
		.where(and(eq(repository.id, id), eq(repository.workspaceId, workspaceId)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, "no such repository in this workspace");
	return row;
}

export async function installationFor(
	repositoryRow: RepositoryRow,
): Promise<{ externalId: string }> {
	const rows = await db
		.select()
		.from(providerInstallation)
		.where(eq(providerInstallation.id, repositoryRow.installationId))
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(409, "the connection to this repository is gone; reconnect it");
	return { externalId: row.externalId };
}

/**
 * Rebuilds a repository's file index from the provider.
 *
 * Delete-then-insert rather than a diff: the tree is a few hundred to a few
 * thousand rows, and reconciling two lists of paths costs more than replacing
 * them. The state column is what makes the UI able to say "indexing" rather
 * than showing an empty picker as though the repository had no files.
 */
export async function reindexRepository(repositoryRow: RepositoryRow): Promise<RepositoryRow> {
	const provider = providerFor(repositoryRow.provider);
	const installation = await installationFor(repositoryRow);
	const ref = repositoryRow.defaultBranch;

	await db
		.update(repository)
		.set({ indexState: "indexing", indexError: "" })
		.where(eq(repository.id, repositoryRow.id));

	try {
		const result = await provider.listFiles(
			installation,
			{ owner: repositoryRow.owner, name: repositoryRow.name },
			ref,
		);

		const paths = result.paths.slice(0, MAX_INDEXED_FILES);

		await db.delete(repositoryFile).where(eq(repositoryFile.repositoryId, repositoryRow.id));
		for (let start = 0; start < paths.length; start += INSERT_CHUNK) {
			await db
				.insert(repositoryFile)
				.values(
					paths.slice(start, start + INSERT_CHUNK).map((path) => ({
						id: nanoid(),
						repositoryId: repositoryRow.id,
						path,
						name: path.slice(path.lastIndexOf("/") + 1),
					})),
				)
				.onConflictDoNothing();
		}

		const patch = {
			indexState: "ready" as const,
			indexRef: ref,
			indexedFileCount: paths.length,
			indexTruncated: result.truncated || result.paths.length > MAX_INDEXED_FILES,
			indexedAt: new Date(),
			indexError: "",
		};
		await db.update(repository).set(patch).where(eq(repository.id, repositoryRow.id));
		return { ...repositoryRow, ...patch };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : "indexing failed";
		const patch = { indexState: "failed" as const, indexError: message.slice(0, 200) };
		await db.update(repository).set(patch).where(eq(repository.id, repositoryRow.id));
		return { ...repositoryRow, ...patch };
	}
}

/**
 * Files matching a query, for `@` autocomplete.
 *
 * Ranked so a basename match beats a match buried in a directory name — typing
 * `schema` should surface `schema.server.ts` before `src/schema/thing.ts`.
 */
export async function searchFiles(
	workspaceId: string,
	options: { query: string; repositoryId?: string; limit?: number },
): Promise<Array<{ repositoryId: string; fullName: string; path: string; url: string }>> {
	const term = options.query.trim().toLowerCase();
	const limit = Math.min(options.limit ?? 20, 50);

	const scope = [eq(repository.workspaceId, workspaceId)];
	if (options.repositoryId !== undefined) scope.push(eq(repository.id, options.repositoryId));

	const conditions = [...scope];
	if (term !== "") {
		const match = or(
			like(repositoryFile.name, `%${term}%`),
			like(repositoryFile.path, `%${term}%`),
		);
		if (match !== undefined) conditions.push(match);
	}

	const rows = await db
		.select({ file: repositoryFile, repo: repository })
		.from(repositoryFile)
		.innerJoin(repository, eq(repository.id, repositoryFile.repositoryId))
		.where(and(...conditions))
		.orderBy(
			// Basename hits first, then shortest path — the shallow file is almost
			// always the one meant.
			sql`case when lower(${repositoryFile.name}) like ${`${term}%`} then 0
			         when lower(${repositoryFile.name}) like ${`%${term}%`} then 1
			         else 2 end`,
			sql`length(${repositoryFile.path})`,
		)
		.limit(limit);

	return rows.map((row) => ({
		repositoryId: row.repo.id,
		fullName: `${row.repo.owner}/${row.repo.name}`,
		path: row.file.path,
		url: providerFor(row.repo.provider).fileUrl(
			{ owner: row.repo.owner, name: row.repo.name },
			row.repo.indexRef === "" ? row.repo.defaultBranch : row.repo.indexRef,
			row.file.path,
		),
	}));
}

/** How many files each repository contributes, for the settings list. */
export async function indexedCounts(repositoryIds: string[]): Promise<Map<string, number>> {
	if (repositoryIds.length === 0) return new Map();
	const rows = await db
		.select({ repositoryId: repositoryFile.repositoryId, total: count() })
		.from(repositoryFile)
		.where(inArray(repositoryFile.repositoryId, repositoryIds))
		.groupBy(repositoryFile.repositoryId);
	return new Map(rows.map((row) => [row.repositoryId, row.total]));
}

/** Which provider ids a workspace has already linked, so the picker can say so. */
export async function linkedExternalIds(
	workspaceId: string,
	provider: GitProviderId,
): Promise<Set<string>> {
	const rows = await db
		.select({ externalId: repository.externalId })
		.from(repository)
		.where(and(eq(repository.workspaceId, workspaceId), eq(repository.provider, provider)));
	return new Set(rows.map((row) => row.externalId));
}
