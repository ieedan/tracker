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
 */
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
