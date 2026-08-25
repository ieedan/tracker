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
