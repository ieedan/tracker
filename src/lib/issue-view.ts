import type { Grouping, Ordering } from "@/lib/components/display-menu";
import type { IssueDto, StatusDto } from "@/lib/types";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/types";

/**
 * Turning a flat list of issues into the sectioned list the view shows.
 *
 * Kept out of the page so the rules — what the groups are, what order they
 * come in, what order issues take inside one — are readable on their own.
 */

export type IssueGroup = {
	/** Stable across recomputes, so rows are patched rather than rebuilt. */
	key: string;
	label: string;
	/** Rendered by the page, which owns the glyphs. */
	kind: Grouping;
	/** The status, priority, assignee, or repo this group stands for. */
	subject: IssueDto["status"] | IssueDto["assignee"] | IssueDto["repo"] | number | null;
	items: IssueDto[];
};

const compare: Record<Ordering, (a: IssueDto, b: IssueDto) => number> = {
	manual: (a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
	// 0 means "no priority", which belongs last rather than first.
	priority: (a, b) => (a.priority || 9) - (b.priority || 9) || compare.manual(a, b),
	updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
	created: (a, b) => b.createdAt.localeCompare(a.createdAt),
	title: (a, b) => a.title.localeCompare(b.title) || compare.manual(a, b),
};

/**
 * Groups are ordered by what they are, not by how many issues they hold: the
 * workspace's status order, Linear's priority order, repos and people
 * alphabetically. An "unassigned" or "no repo" bucket always sorts last.
 */
export function groupIssues(
	issues: readonly IssueDto[],
	statuses: readonly StatusDto[],
	grouping: Grouping,
	ordering: Ordering,
): IssueGroup[] {
	const sorted = [...issues].sort(compare[ordering]);

	if (grouping === "none") {
		return sorted.length === 0
			? []
			: [{ key: "all", label: "All issues", kind: "none", subject: null, items: sorted }];
	}

	if (grouping === "status") {
		return statuses
			.map((status) => ({
				key: status.id,
				label: status.name,
				kind: "status" as const,
				subject: status,
				items: sorted.filter((issue) => issue.status.id === status.id),
			}))
			.filter((group) => group.items.length > 0);
	}

	if (grouping === "priority") {
		return PRIORITIES.map((priority) => ({
			key: `priority-${priority}`,
			label: PRIORITY_LABELS[priority],
			kind: "priority" as const,
			subject: priority,
			items: sorted.filter((issue) => issue.priority === priority),
		}))
			.filter((group) => group.items.length > 0)
			.sort((a, b) => (Number(a.subject) || 9) - (Number(b.subject) || 9));
	}

	if (grouping === "assignee") {
		const people = new Map<string, IssueDto["assignee"]>();
		for (const issue of sorted) {
			if (issue.assignee !== null) people.set(issue.assignee.id, issue.assignee);
		}

		const groups: IssueGroup[] = [...people.values()]
			.sort((a, b) => a!.name.localeCompare(b!.name))
			.map((person) => ({
				key: person!.id,
				label: person!.name,
				kind: "assignee" as const,
				subject: person,
				items: sorted.filter((issue) => issue.assignee?.id === person!.id),
			}));

		const unassigned = sorted.filter((issue) => issue.assignee === null);
		if (unassigned.length > 0) {
			groups.push({
				key: "unassigned",
				label: "No assignee",
				kind: "assignee",
				subject: null,
				items: unassigned,
			});
		}

		return groups;
	}

	const repos = new Map<string, IssueDto["repo"]>();
	for (const issue of sorted) {
		if (issue.repo !== null) repos.set(issue.repo.id, issue.repo);
	}

	const groups: IssueGroup[] = [...repos.values()]
		.sort((a, b) => a!.name.localeCompare(b!.name))
		.map((repo) => ({
			key: repo!.id,
			label: repo!.name,
			kind: "repo" as const,
			subject: repo,
			items: sorted.filter((issue) => issue.repo?.id === repo!.id),
		}));

	const unscoped = sorted.filter((issue) => issue.repo === null);
	if (unscoped.length > 0) {
		groups.push({
			key: "no-repo",
			label: "No repo",
			kind: "repo",
			subject: null,
			items: unscoped,
		});
	}

	return groups;
}
