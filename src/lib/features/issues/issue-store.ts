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
	title?: string;
	description?: string;
	status?: Issue["status"];
	priority?: Issue["priority"];
	assigneeId?: string | null;
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
	number: number,
	patch: IssuePatch,
	apply: (issue: Issue) => Issue,
): Promise<Issue | undefined> {
	const before = issues.get();
	issues.set(before.map((issue) => (issue.number === number ? apply(issue) : issue)));

	const { data, error } = await api.PATCH("/api/v1/workspaces/[slug]/issues/[number]", {
		params: { slug, number: String(number) },
		body: patch,
	});

	if (error !== undefined) {
		issues.set(before);
		toastError(messageOf(error, "Could not update the issue"));
		return undefined;
	}

	issues.set(issues.get().map((issue) => (issue.number === number ? data : issue)));
	return data;
}
