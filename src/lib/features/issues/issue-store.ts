// One place that knows how to change an issue and keep the screen in step.
//
// Kit has no way to re-run a load after a mutation (no `invalidate`), so a page
// seeds a signal from its load data and this module patches that signal as
// changes land. Every edit is optimistic: the row moves the moment you pick,
// and rolls back if the request fails.
//
// The same gap means a page never hears about work done elsewhere — another
// member, or an agent through the API. `refreshIssues` re-reads the list so a
// caller can poll it.
import type { Signal } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import type { Issue } from "@/lib/domain/schemas";

export interface IssuePatch {
	/** Moving teams reallocates the number, so the identifier changes. */
	teamKey?: string;
	title?: string;
	description?: string;
	status?: Issue["status"];
	priority?: Issue["priority"];
	assigneeId?: string | null;
	/** `null` clears the scope. */
	repositoryId?: string | null;
	labelIds?: string[];
}

/**
 * Applies a patch, optimistically.
 *
 * `apply` describes the change locally so the UI moves at once; the server's
 * answer then replaces the row wholesale, which is what keeps `updatedAt` and
 * the resolved assignee honest.
 */
export async function patchIssue(
	issues: Signal<Issue[]>,
	slug: string,
	/** The issue's id — stable across a team move, unlike its identifier. */
	id: string,
	identifier: string,
	patch: IssuePatch,
	apply: (issue: Issue) => Issue,
): Promise<Issue | undefined> {
	const before = issues.get();
	issues.set(before.map((issue) => (issue.id === id ? apply(issue) : issue)));

	const { data, error } = await api.PATCH("/api/v1/workspaces/[slug]/issues/[identifier]", {
		params: { slug, identifier },
		body: patch,
	});

	if (error !== undefined) {
		issues.set(before);
		toastError(messageOf(error, "Could not update the issue"));
		return undefined;
	}

	// Matched by id: a team move changes the identifier, so that is not a key.
	issues.set(issues.get().map((issue) => (issue.id === id ? data : issue)));
	return data;
}

/**
 * Same as `patchIssue`, for a set of rows. Optimistic first, then one request
 * each — sequential so a team move does not collide on the next number.
 */
export async function patchIssues(
	issues: Signal<Issue[]>,
	slug: string,
	ids: readonly string[],
	patch: IssuePatch | ((issue: Issue) => IssuePatch),
	apply: (issue: Issue) => Issue,
): Promise<Issue[]> {
	const wanted = new Set(ids);
	const snapshot = new Map(issues.get().map((issue) => [issue.id, issue]));
	const targets = [...wanted]
		.map((id) => snapshot.get(id))
		.filter((issue): issue is Issue => issue !== undefined);
	if (targets.length === 0) return [];

	issues.set(issues.get().map((issue) => (wanted.has(issue.id) ? apply(issue) : issue)));

	const succeeded: Issue[] = [];
	const failed: string[] = [];

	for (const issue of targets) {
		const body = typeof patch === "function" ? patch(issue) : patch;
		const { data, error } = await api.PATCH("/api/v1/workspaces/[slug]/issues/[identifier]", {
			params: { slug, identifier: issue.identifier },
			body,
		});

		if (error !== undefined || data === undefined) {
			failed.push(issue.id);
			issues.update((list) =>
				list.map((row) => (row.id === issue.id ? (snapshot.get(issue.id) ?? row) : row)),
			);
			continue;
		}

		succeeded.push(data);
		issues.update((list) => list.map((row) => (row.id === issue.id ? data : row)));
	}

	if (failed.length === targets.length) {
		toastError("Could not update the issues");
	} else if (failed.length > 0) {
		toastError(
			`Updated ${succeeded.length} issue${succeeded.length === 1 ? "" : "s"}, ${failed.length} failed`,
		);
	}

	return succeeded;
}

/**
 * Deletes a set of issues.
 *
 * Optimistic like the patches, but with nothing to reconcile afterwards: a
 * deleted row has no server answer to replace it with, so the rows leave the
 * list at once and only the ones the server refused come back. The list sorts
 * itself for display, so putting a refused row back on the end is enough to
 * return it to where it was.
 *
 * Sequential, like `patchIssues`, so a partial failure can say how far it got.
 * Returns the ids that are actually gone — the caller uses that to drop them
 * from a selection, or to leave the page the deleted issue was on.
 */
export async function deleteIssues(
	issues: Signal<Issue[]>,
	slug: string,
	ids: readonly string[],
): Promise<string[]> {
	const wanted = new Set(ids);
	const targets = issues.get().filter((issue) => wanted.has(issue.id));
	if (targets.length === 0) return [];

	issues.update((list) => list.filter((issue) => !wanted.has(issue.id)));

	const deleted: string[] = [];
	const refused: Issue[] = [];

	for (const issue of targets) {
		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/issues/[identifier]", {
			params: { slug, identifier: issue.identifier },
		});
		if (error !== undefined) {
			refused.push(issue);
			continue;
		}
		deleted.push(issue.id);
	}

	if (refused.length > 0) {
		issues.update((list) => {
			// A poll may have put a row back while the request was in the air.
			const present = new Set(list.map((issue) => issue.id));
			return [...list, ...refused.filter((issue) => !present.has(issue.id))];
		});
	}

	if (deleted.length === 0) {
		toastError(
			targets.length === 1 ? "Could not delete this issue" : "Could not delete the issues",
		);
	} else if (refused.length > 0) {
		toastError(`Deleted ${deleted.length}, ${refused.length} failed`);
	}

	return deleted;
}

/** Which list a page is showing — `teamKey` is `null` on the workspace-wide one. */
export interface IssueScope {
	slug: string;
	teamKey: string | null;
}

/**
 * Re-reads the list the page is showing and replaces it wholesale.
 *
 * Read as a poll, so it defers to anything happening locally. Every local write
 * — an optimistic edit, a create, a transfer — replaces the array in `issues`,
 * so an answer is only applied when the array it started against is still the
 * one on screen. Anything that moved in the meantime wins, and the next tick
 * picks the server up again a moment later.
 *
 * A failed read is swallowed: a list a few seconds stale is not worth a toast.
 *
 * `scope` is read on each call rather than captured, so one timer survives a
 * client navigation that reseeds the page instead of remounting it.
 */
export async function refreshIssues(
	issues: Signal<Issue[]>,
	scope: () => IssueScope,
): Promise<void> {
	const before = scope();
	if (before.slug === "") return;
	const seen = issues.get();

	const { data, error } = await api.GET("/api/v1/workspaces/[slug]/issues", {
		params: { slug: before.slug },
		// `undefined` drops out of the query string, which is the workspace-wide list.
		query: { team: before.teamKey ?? undefined },
	});
	if (error !== undefined) return;

	// Something local moved while this was in the air, or the page is showing a
	// different list now. Either way this answer is the wrong one to apply.
	if (issues.get() !== seen) return;
	const now = scope();
	if (now.slug !== before.slug || now.teamKey !== before.teamKey) return;

	issues.set(data);
}
