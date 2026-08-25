/**
 * Issue filters: what they are, how they read in the URL, and what they match.
 *
 * The URL is the source of truth. Filters are parsed out of the query string on
 * every render — which is what makes a filtered view shareable, survive a
 * reload, and render correctly on the server rather than flashing unfiltered
 * content and then narrowing.
 *
 * The wire format stays legible on purpose:
 *
 *   ?status=todo,in_progress     status is Todo or In Progress
 *   ?status=!done,canceled       status is not Done or Canceled
 *   ?assignee=none               unassigned
 *   ?label=<id>&team=ENG         combined — every filter must match
 *   ?view=backlog&priority=high  the Backlog tab, narrowed to High
 *
 * The view tabs ride in the same query string under their own `view` key —
 * see the bottom of this file.
 */
import type { IssueStatus } from "@/lib/domain/issues";
import type { Issue } from "@/lib/domain/schemas";

export const FILTER_FIELDS = [
	"status",
	"priority",
	"assignee",
	"label",
	"team",
	"creator",
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
	status: "Status",
	priority: "Priority",
	assignee: "Assignee",
	label: "Label",
	team: "Team",
	creator: "Creator",
};

export interface Filter {
	field: FilterField;
	/** `is not` rather than `is`. */
	negated: boolean;
	/** Matched as "any of". An empty list makes the filter inert. */
	values: string[];
}

/** The sentinel for "nobody", so unassigned issues are filterable. */
export const NO_ASSIGNEE = "none";

/** Reads filters out of a query string. Unknown keys and empty values are ignored. */
export function parseFilters(search: string): Filter[] {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	const filters: Filter[] = [];

	for (const field of FILTER_FIELDS) {
		const raw = params.get(field);
		if (raw === null || raw === "") continue;

		const negated = raw.startsWith("!");
		const values = (negated ? raw.slice(1) : raw)
			.split(",")
			.map((value) => value.trim())
			.filter((value) => value !== "");

		if (values.length === 0) continue;
		filters.push({ field, negated, values });
	}

	return filters;
}

/**
 * Writes filters back into a query string, preserving any unrelated params
 * already there — the list's search box lives in the URL too on a shared link,
 * and a filter change must not drop it.
 */
export function serializeFilters(filters: Filter[], existingSearch = ""): string {
	const params = new URLSearchParams(
		existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
	);

	for (const field of FILTER_FIELDS) params.delete(field);

	for (const filter of filters) {
		if (filter.values.length === 0) continue;
		params.set(filter.field, `${filter.negated ? "!" : ""}${filter.values.join(",")}`);
	}

	const query = params.toString();
	return query === "" ? "" : `?${query}`;
}

/** Every filter must match; within one filter, any value may. */
export function matchesFilters(issue: Issue, filters: Filter[]): boolean {
	return filters.every((filter) => {
		if (filter.values.length === 0) return true;
		return filter.negated ? !matchesOne(issue, filter) : matchesOne(issue, filter);
	});
}

function matchesOne(issue: Issue, filter: Filter): boolean {
	const values = filter.values;

	switch (filter.field) {
		case "status":
			return values.includes(issue.status);
		case "priority":
			return values.includes(issue.priority);
		case "assignee":
			return issue.assignee === null
				? values.includes(NO_ASSIGNEE)
				: values.includes(issue.assignee.id);
		case "label":
			// "has any of these labels" — and negated, "has none of them".
			return issue.labels.some((label) => values.includes(label.id));
		case "team":
			return values.includes(issue.team.key);
		case "creator":
			return values.includes(issue.creator.id);
	}
}

/** `is` / `is any of` / `is not` / `is not any of`, the way Linear reads them. */
export function operatorLabel(filter: Filter): string {
	const many = filter.values.length > 1;
	if (filter.negated) return many ? "is not any of" : "is not";
	return many ? "is any of" : "is";
}

/** Adds or removes one value, keeping the rest of the filter intact. */
export function toggleValue(filter: Filter, value: string): Filter {
	const values = filter.values.includes(value)
		? filter.values.filter((entry) => entry !== value)
		: [...filter.values, value];
	return { ...filter, values };
}

/** Replaces the filter for a field, dropping it entirely when it empties out. */
export function withFilter(filters: Filter[], next: Filter): Filter[] {
	const without = filters.filter((filter) => filter.field !== next.field);
	if (next.values.length === 0) return without;

	// Keep the original position so chips do not jump around as they are edited.
	const index = filters.findIndex((filter) => filter.field === next.field);
	if (index === -1) return [...without, next];

	const copy = [...filters];
	copy[index] = next;
	return copy;
}

/** Sets a field's values in one shot, keeping `is` / `is not`. */
export function setFieldValues(filters: Filter[], field: FilterField, values: string[]): Filter[] {
	const existing = filters.find((filter) => filter.field === field);
	return withFilter(filters, {
		field,
		negated: existing?.negated ?? false,
		values,
	});
}

export function removeField(filters: Filter[], target: FilterField): Filter[] {
	return filters.filter((filter) => filter.field !== target);
}

/**
 * The view tabs above the list — Linear's Active / Backlog / All.
 *
 * A view is a coarse band of statuses rather than a filter, and it rides in the
 * URL under its own `view` key so the two compose instead of fighting: picking
 * Backlog and then adding a priority filter narrows *within* the tab, and
 * `serializeFilters` leaves the key alone because it only ever rewrites the
 * filter fields it owns.
 */
export const ISSUE_VIEWS = ["active", "backlog", "all"] as const;
export type IssueView = (typeof ISSUE_VIEWS)[number];

export const ISSUE_VIEW_LABELS: Record<IssueView, string> = {
	active: "Active",
	backlog: "Backlog",
	all: "All",
};

/**
 * What each tab admits, `null` meaning "no opinion". Linear's split: Active is
 * the work in flight, Backlog is what nobody has picked up yet, and All is
 * everything — the terminal states included.
 */
export const VIEW_STATUSES: Record<IssueView, readonly IssueStatus[] | null> = {
	active: ["todo", "in_progress"],
	backlog: ["backlog"],
	all: null,
};

/**
 * Where a bare URL lands. `all` rather than Linear's `active`, so every link
 * and bookmark made before the tabs existed still shows what it used to
 * instead of quietly dropping Done and Canceled — flip this one constant to
 * open on Active instead.
 */
export const DEFAULT_VIEW: IssueView = "all";

const VIEW_PARAM = "view";

/** Reads the tab out of a query string; anything unrecognised is the default. */
export function parseView(search: string): IssueView {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	const raw = params.get(VIEW_PARAM);
	return ISSUE_VIEWS.find((view) => view === raw) ?? DEFAULT_VIEW;
}

/** Writes the tab back, preserving the filters and the search box beside it. */
export function serializeView(view: IssueView, existingSearch = ""): string {
	const params = new URLSearchParams(
		existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
	);

	// The default tab is the absence of the key, so a plain list link stays plain.
	if (view === DEFAULT_VIEW) params.delete(VIEW_PARAM);
	else params.set(VIEW_PARAM, view);

	const query = params.toString();
	return query === "" ? "" : `?${query}`;
}

/** The URL a tab points at — this path, this tab, everything else untouched. */
export function viewHref(location: { path: string; search: string }, view: IssueView): string {
	return `${location.path}${serializeView(view, location.search)}`;
}

export function matchesView(issue: Issue, view: IssueView): boolean {
	const statuses = VIEW_STATUSES[view];
	return statuses === null || statuses.includes(issue.status);
}
