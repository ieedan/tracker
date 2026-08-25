// One place that knows how to change an issue and keep the screen in step.
//
// Kit has no way to re-run a load after a mutation (no `invalidate`), so a page
// seeds a signal from its load data and this module patches that signal as
// changes land. Every edit is optimistic: the row moves the moment you pick,
// and rolls back if the request fails.
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
