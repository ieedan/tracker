import { router } from "$implement/router";
import {
	Div,
	ForEach,
	H1,
	If,
	ImplementDocument,
	ImplementLifecycle,
	Input,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Plus, Search } from "@implementjs/lucide";
import { navigateTo } from "@implementjs/core";
import { isTyping } from "@/lib/client/is-typing";
import { StatusIcon } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import {
	ISSUE_STATUSES,
	STATUS_LABELS,
	PRIORITY_ORDER,
	type IssueStatus,
} from "@/lib/domain/issues";
import type { Issue, Label, Member, Team, TeamRef, Workspace } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { issueCreated, openCreateIssue } from "./create-issue-dialog";
import { AddFilterButton, FilterBar, type FilterContext } from "./filter-bar";
import { matchesFilters, parseFilters, serializeFilters, type Filter } from "./filters";
import { AssigneePicker, LabelChips, PriorityPicker, StatusPicker, TeamBadge } from "./pickers";
import { RepositoryBadge } from "./repository-picker";
import { PullRequestBadge } from "./pull-request-link";
import { patchIssue } from "./issue-store";

interface PageData {
	issues: Issue[];
	/** Set on a team route, `null` on the workspace-wide list. */
	team: TeamRef | null;
	workspace: Workspace;
	teams: Team[];
	members: Member[];
	labels: Label[];
}

export function IssueListPage({
	data,
	params,
	url,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
	url: Readable<{ path: string; search: string }>;
}) {
	const issues = signal(data.get().issues);
	// A client navigation between workspaces reseeds the load rather than
	// remounting the page, so the local list has to follow `data`.
	data.onChange((next) => issues.set(next.issues));

	const query = signal("");

	// The URL is the filter state. Deriving from it rather than mirroring it into
	// a signal means a shared link, a reload and the back button all land on the
	// same view — and the server render is already filtered, so nothing flashes
	// unfiltered and then narrows.
	const filters = derived([url], (location) => parseFilters(location.search));

	const applyFilters = (next: Filter[]) => {
		const location = url.get();
		const search = serializeFilters(next, location.search);
		// `replace` so a filter fiddle does not bury the previous page under a
		// dozen history entries; `noScroll` so a long list stays where it is.
		navigateTo(`${location.path}${search}`, { replace: true, noScroll: true });
	};

	const filterContext = derived([data], (value): FilterContext => ({
		teams: value.teams,
		members: value.members,
		labels: value.labels,
		hideTeam: value.team !== null,
	}));

	const addFilterOpen = signal(false);

	const visible = derived([issues, query, filters], (list, term, active) => {
		const needle = term.trim().toLowerCase();
		const matched =
			active.length === 0 ? list : list.filter((issue) => matchesFilters(issue, active));
		if (needle === "") return matched;
		return matched.filter(
			(issue) =>
				issue.title.toLowerCase().includes(needle) ||
				issue.identifier.toLowerCase().includes(needle),
		);
	});

	const searchRef = signal<HTMLInputElement | null>(null);
	const hoveredId = signal<string | null>(null);
	const rowMenu = signal<{ id: string; field: "status" | "priority" | "assignee" } | null>(null);

	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },

		// The composer lives in the shell, outside this page, so a create is
		// announced through a module signal. It outlives the page, so the
		// subscription is scoped to the mount.
		ImplementLifecycle({
			onMount: () =>
				issueCreated.onChange((created) => {
					if (created === null) return;
					// A team-scoped list only takes issues filed to that team.
					const scope = data.get().team;
					if (scope !== null && created.team.id !== scope.id) return;
					if (!data.get().teams.some((team) => team.id === created.team.id)) return;
					issues.update((list) =>
						list.some((issue) => issue.id === created.id) ? list : [created, ...list],
					);
				}),
		}),

		// `c` opens the composer, `/` focuses search — the two Linear reflexes.
		ImplementDocument({
			onKeydown: (event) => {
				if (isTyping(event.target)) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				const key = event.key.toLowerCase();
				if (key === "c") {
					event.preventDefault();
					openCreateIssue(params.slug.get(), data.get().team?.key);
					return;
				}
				if (key === "/") {
					event.preventDefault();
					searchRef.get()?.focus();
					return;
				}
				if (key === "f") {
					event.preventDefault();
					addFilterOpen.set(true);
					return;
				}
				const hovered = hoveredId.get();
				if (hovered === null) return;
				if (key === "s") {
					event.preventDefault();
					rowMenu.set({ id: hovered, field: "status" });
				} else if (key === "p") {
					event.preventDefault();
					rowMenu.set({ id: hovered, field: "priority" });
				} else if (key === "a") {
					event.preventDefault();
					rowMenu.set({ id: hovered, field: "assignee" });
				}
			},
		}),

		Header(
			data,
			query,
			searchRef,
			params,
			visible,
			filters,
			filterContext,
			applyFilters,
			addFilterOpen,
		),
		FilterBar({ filters, context: filterContext, onChange: applyFilters }),

		Div(
			{ class: "min-h-0 flex-1 overflow-y-auto" },
			If(
				visible.bind((list) => list.length === 0),
				EmptyState(query, params, data, filters, applyFilters),
			),
			...ISSUE_STATUSES.map((status) =>
				StatusGroup(status, visible, issues, data, params, hoveredId, rowMenu),
			),
		),
	);
}

function Header(
	data: Readable<PageData>,
	query: ReturnType<typeof signal<string>>,
	searchRef: ReturnType<typeof signal<HTMLInputElement | null>>,
	params: { slug: Readable<string> },
	visible: Readable<Issue[]>,
	filters: Readable<Filter[]>,
	filterContext: Readable<FilterContext>,
	applyFilters: (next: Filter[]) => void,
	addFilterOpen: ReturnType<typeof signal<boolean>>,
) {
	return Div(
		{
			class: "flex h-12 shrink-0 items-center gap-3 border-b border-border px-4",
		},
		H1(
			{ class: "text-[15px] font-semibold tracking-tight" },
			data.bind((value) => value.team?.name ?? "All issues"),
		),
		If(
			data.bind((value) => value.team !== null),
			Span(
				{
					class: "rounded border border-border px-1.5 font-mono text-[11px] text-muted-foreground",
				},
				data.bind((value) => value.team?.key ?? ""),
			),
		),
		Span(
			{ class: "rounded bg-secondary px-1.5 text-[11px] text-muted-foreground" },
			// The count follows what is actually listed, so a filter that hides
			// everything reads as 0 rather than the unfiltered total.
			visible.bind((list) => `${list.length}`),
		),

		AddFilterButton(filters, filterContext, applyFilters, addFilterOpen),

		Div(
			{ class: "relative ml-auto" },
			Search({
				class:
					"pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground",
			}),
			Input({
				this: searchRef,
				value: query,
				placeholder: "Search issues…",
				class:
					"h-7 w-56 rounded-md border border-input bg-background pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring",
			}),
		),
		Button(
			{
				size: "sm",
				class: "gap-1.5",
				onClick: () => openCreateIssue(params.slug.get(), data.get().team?.key),
			},
			Plus({ class: "size-3.5" }),
			"New issue",
		),
	);
}

function EmptyState(
	query: Readable<string>,
	params: { slug: Readable<string> },
	data: Readable<PageData>,
	filters: Readable<Filter[]>,
	applyFilters: (next: Filter[]) => void,
) {
	return Div(
		{ class: "flex flex-col items-center justify-center gap-3 py-24 text-center" },

		// "Nothing here" means three different things; say which one.
		Div(
			{ class: "text-[13px] text-muted-foreground" },
			derived([query, filters], (term, active) => {
				if (term.trim() !== "") return `Nothing matches \u201C${term}\u201D.`;
				return active.length > 0 ? "No issues match these filters." : "No issues yet.";
			}),
		),

		If(
			filters.bind((active) => active.length > 0),
			Button(
				{ size: "sm", variant: "secondary", onClick: () => applyFilters([]) },
				"Clear filters",
			),
		),

		If(
			derived([query, filters], (term, active) => term.trim() === "" && active.length === 0),
			Button(
				{
					size: "sm",
					variant: "secondary",
					onClick: () => openCreateIssue(params.slug.get(), data.get().team?.key),
				},
				"Create the first issue",
			),
		),
	);
}

/** Linear groups the backlog by status, with a count on each band. */
function StatusGroup(
	status: IssueStatus,
	visible: Readable<Issue[]>,
	issues: ReturnType<typeof signal<Issue[]>>,
	data: Readable<PageData>,
	params: { slug: Readable<string> },
	hoveredId: ReturnType<typeof signal<string | null>>,
	rowMenu: Signal<{ id: string; field: "status" | "priority" | "assignee" } | null>,
) {
	const rows = derived([visible], (list) =>
		list
			.filter((issue) => issue.status === status)
			// Urgent first, then by most recently touched.
			.toSorted(
				(a, b) =>
					PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
					b.updatedAt.localeCompare(a.updatedAt),
			),
	);

	return If(
		rows.bind((list) => list.length > 0),
		Div(
			{},
			Div(
				{
					class:
						"flex h-8 items-center gap-2 border-b border-border/60 bg-secondary/40 px-4 text-[12px] font-medium",
				},
				StatusIcon(status),
				Span({}, STATUS_LABELS[status]),
				Span(
					{ class: "text-muted-foreground" },
					rows.bind((list) => `${list.length}`),
				),
			),
			ForEach(
				rows,
				(issue) => issue.id,
				(issue) => IssueRow(issue, issues, data, params, hoveredId, rowMenu),
			),
		),
	);
}

function IssueRow(
	issue: Readable<Issue>,
	issues: ReturnType<typeof signal<Issue[]>>,
	data: Readable<PageData>,
	params: { slug: Readable<string> },
	hoveredId: ReturnType<typeof signal<string | null>>,
	rowMenu: Signal<{ id: string; field: "status" | "priority" | "assignee" } | null>,
) {
	const slug = params.slug;
	const id = issue.get().id;

	const update = (patch: Parameters<typeof patchIssue>[4], apply: (value: Issue) => Issue) =>
		void patchIssue(issues, slug.get(), id, issue.get().identifier, patch, apply);

	return Div(
		{
			class:
				"row-hover group flex h-10 items-center gap-2 border-b border-border/40 px-4 text-[13px]",
			onMouseenter: () => hoveredId.set(id),
			onMouseleave: () => hoveredId.set(null),
		},

		PriorityPicker(
			issue.bind("priority"),
			(priority) => update({ priority }, (value) => ({ ...value, priority })),
			{ open: menuOpen(rowMenu, id, "priority") },
		),

		Span(
			{ class: "w-16 shrink-0 font-mono text-[12px] text-muted-foreground" },
			issue.bind("identifier"),
		),

		StatusPicker(
			issue.bind("status"),
			(status) => update({ status }, (value) => ({ ...value, status })),
			{ open: menuOpen(rowMenu, id, "status") },
		),

		router.Link(
			{
				to: "/app/:slug/issue/:identifier",
				params: { slug, identifier: issue.bind("identifier") },
				class: "min-w-0 flex-1 truncate hover:underline",
			},
			issue.bind("title"),
		),

		Div(
			{ class: "flex shrink-0 items-center gap-1" },
			// On a team route every row is the same team, so the badge is noise.
			If(
				data.bind((value) => value.team === null),
				TeamBadge(issue.bind("team")),
			),
			RepositoryBadge(issue.bind((value) => value.repository)),
			PullRequestBadge(issue.bind((value) => value.pullRequest)),
			LabelChips(issue.bind("labels")),
		),

		Span(
			{ class: "w-10 shrink-0 text-right text-[12px] text-muted-foreground" },
			issue.bind((value) => relativeTime(value.updatedAt)),
		),

		AssigneePicker(
			issue.bind("assignee"),
			data.bind((value) => value.members),
			(assigneeId) =>
				update({ assigneeId }, (value) => ({
					...value,
					assignee:
						assigneeId === null
							? null
							: (data.get().members.find((member) => member.user.id === assigneeId)?.user ??
								value.assignee),
				})),
			{ open: menuOpen(rowMenu, id, "assignee") },
		),
	);
}

function menuOpen(
	menu: Signal<{ id: string; field: "status" | "priority" | "assignee" } | null>,
	id: string,
	field: "status" | "priority" | "assignee",
): Signal<boolean> {
	return menu.bind(
		(current) => current?.id === id && current?.field === field,
		(current, open) =>
			open ? { id, field } : current?.id === id && current?.field === field ? null : current,
	);
}
