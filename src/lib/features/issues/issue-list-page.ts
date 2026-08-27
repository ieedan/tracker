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
import { LayoutList, ListFilter, Plus, Search } from "@implementjs/lucide";
import { navigateTo } from "@implementjs/core";
import { isTyping } from "@/lib/client/is-typing";
import { StatusIcon } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import {
	BulkActionsDialog,
	BulkSelectionBar,
	IssueCheckbox,
	SelectIssuesCheckbox,
	rowCheckboxClass,
	type BulkView,
} from "./bulk-actions";
import {
	ISSUE_STATUSES,
	STATUS_LABELS,
	PRIORITY_ORDER,
	type IssueStatus,
} from "@/lib/domain/issues";
import type {
	Issue,
	Label,
	Member,
	Repository,
	Team,
	TeamRef,
	Workspace,
} from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { issueCreated, openCreateIssue } from "./create-issue-dialog";
import { AddFilterButton, FilterBar, type FilterContext } from "./filter-bar";
import {
	ALL_VIEW,
	ISSUE_VIEW_LABELS,
	matchesFilters,
	matchesView,
	parseFilters,
	parseView,
	serializeFilters,
	viewHref,
	type Filter,
	type IssueView,
} from "./filters";
import { ViewTabs } from "./view-tabs";
import { AssigneePicker, LabelChips, PriorityPicker, StatusPicker, TeamBadge } from "./pickers";
import { RepositoryBadge } from "./repository-picker";
import { PullRequestBadge } from "./pull-request-link";
import { patchIssue, refreshIssues, type IssueScope } from "./issue-store";

/**
 * How often the list re-reads itself. Same cadence as the inbox badge: near
 * enough to live that you stop reaching for reload, cheap enough to leave on.
 */
const POLL_MS = 15_000;

interface PageData {
	issues: Issue[];
	/** Set on a team route, `null` on the workspace-wide list. */
	team: TeamRef | null;
	workspace: Workspace;
	teams: Team[];
	members: Member[];
	labels: Label[];
	/** For the bulk repository action; empty when the workspace has linked none. */
	repositories: Repository[];
	user: { id: string };
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

	// Read fresh on every tick: the same reseed means one timer has to keep
	// pointing at whatever list is on screen now.
	const scope = (): IssueScope => ({
		slug: params.slug.get(),
		teamKey: data.get().team?.key ?? null,
	});
	const refresh = () => void refreshIssues(issues, scope);

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

	// The tab is URL state too, under its own key — so it survives a reload,
	// pastes as a link, and narrows *with* the filters rather than instead of
	// them. `serializeFilters` only rewrites the fields it owns, so a filter
	// edit carries the tab through untouched.
	const view = derived([url], (location) => parseView(location.search));

	const applyView = (next: IssueView) => {
		navigateTo(viewHref(url.get(), next), { noScroll: true });
	};

	const filterContext = derived([data], (value): FilterContext => ({
		teams: value.teams,
		members: value.members,
		labels: value.labels,
		hideTeam: value.team !== null,
	}));

	const addFilterOpen = signal(false);

	const visible = derived([issues, query, filters, view], (list, term, active, tab) => {
		const needle = term.trim().toLowerCase();
		// Tab first, then the filters within it, then the search box.
		const inView = list.filter((issue) => matchesView(issue, tab));
		const matched =
			active.length === 0 ? inView : inView.filter((issue) => matchesFilters(issue, active));
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
	const selected = signal<string[]>([]);
	const bulkOpen = signal(false);
	const bulkView = signal<BulkView>("root");
	const anySelected = selected.bind((ids) => ids.length > 0);

	const openBulk = (view: BulkView = "root") => {
		bulkView.set(view);
		bulkOpen.set(true);
	};

	return Div(
		{ class: "relative flex min-h-0 flex-1 flex-col" },

		// Nothing pushes here yet, so the list polls: work filed or moved by
		// another member — or by an agent over the API — shows up on its own
		// instead of waiting for a reload.
		ImplementLifecycle({
			onMount: () => {
				const timer = setInterval(() => {
					// A hidden tab has nobody to show the update to. The visibility
					// handler catches it up the moment it comes back.
					if (document.visibilityState === "visible") refresh();
				}, POLL_MS);

				const onVisible = () => {
					if (document.visibilityState === "visible") refresh();
				};
				document.addEventListener("visibilitychange", onVisible);

				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			},
		}),

		ImplementLifecycle({
			onMount: () =>
				issues.onChange((list) => {
					const live = new Set(list.map((issue) => issue.id));
					selected.update((ids) => {
						const next = ids.filter((id) => live.has(id));
						return next.length === ids.length ? ids : next;
					});
				}),
		}),

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
				if (isTyping(event)) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				if (bulkOpen.get()) return;
				const key = event.key.toLowerCase();
				if (key === "escape") {
					if (selected.get().length === 0) return;
					event.preventDefault();
					selected.set([]);
					return;
				}
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
				if (key === "x" && hovered !== null) {
					event.preventDefault();
					selected.update((ids) =>
						ids.includes(hovered) ? ids.filter((id) => id !== hovered) : [...ids, hovered],
					);
					return;
				}
				// With a selection, shortcuts apply to the set — not the hovered row.
				if (selected.get().length > 0) {
					if (key === "s") {
						event.preventDefault();
						openBulk("status");
					} else if (key === "p") {
						event.preventDefault();
						openBulk("priority");
					} else if (key === "a") {
						event.preventDefault();
						openBulk("assignee");
					} else if (key === "l") {
						event.preventDefault();
						openBulk("labels");
					} else if (key === "t") {
						event.preventDefault();
						openBulk("team");
					} else if (key === "r" && data.get().repositories.length > 0) {
						event.preventDefault();
						openBulk("repository");
					}
					return;
				}
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
			selected,
		),
		ViewTabs({ url }),
		FilterBar({ filters, context: filterContext, onChange: applyFilters }),
		BulkActionsDialog({
			open: bulkOpen,
			view: bulkView,
			slug: params.slug,
			userId: data.bind((value) => value.user.id),
			issues,
			selected,
			members: data.bind((value) => value.members),
			labels: data.bind((value) => value.labels),
			teams: data.bind((value) => value.teams),
			repositories: data.bind((value) => value.repositories),
		}),

		Div(
			{
				class: [
					"min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
					anySelected.bind((on) => (on ? "pb-16" : "")),
				],
			},
			If(
				visible.bind((list) => list.length === 0),
				EmptyState(query, params, data, filters, applyFilters, view, applyView),
			),
			...ISSUE_STATUSES.map((status) =>
				StatusGroup(
					status,
					visible,
					issues,
					data,
					params,
					hoveredId,
					rowMenu,
					selected,
					anySelected,
				),
			),
		),
		BulkSelectionBar({ selected, open: bulkOpen, view: bulkView }),
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
	selected: ReturnType<typeof signal<string[]>>,
) {
	return Div(
		{
			class:
				"flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 sm:h-12 sm:flex-nowrap sm:py-0",
		},
		SelectIssuesCheckbox({
			selected,
			issues: visible,
			label: "Select all visible issues",
		}),
		H1(
			{ class: "text-[15px] font-semibold tracking-tight" },
			data.bind((value) => value.team?.name ?? "Issues"),
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

		// The search takes a full row of its own on a phone, where 14rem of
		// input and the buttons cannot share one.
		Div(
			{ class: "relative order-last w-full sm:order-none sm:ml-auto sm:w-auto" },
			Search({
				class:
					"pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground",
			}),
			Input({
				this: searchRef,
				value: query,
				placeholder: "Search issues…",
				class:
					"h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus:border-ring sm:w-56",
			}),
		),
		Button(
			{
				size: "sm",
				class: "ml-auto gap-1.5 sm:ml-0",
				"aria-label": "New issue",
				onClick: () => openCreateIssue(params.slug.get(), data.get().team?.key),
			},
			Plus({ class: "size-3.5" }),
			Span({ class: "hidden sm:inline" }, "New issue"),
		),
	);
}

function EmptyState(
	query: Readable<string>,
	params: { slug: Readable<string> },
	data: Readable<PageData>,
	filters: Readable<Filter[]>,
	applyFilters: (next: Filter[]) => void,
	view: Readable<IssueView>,
	applyView: (next: IssueView) => void,
) {
	// "Nothing here" means four different things; say which one.
	return If(
		query.bind((term) => term.trim() !== ""),
		Empty(
			EmptyHeader(
				EmptyMedia({ variant: "icon" }, Search({ "aria-hidden": true })),
				EmptyTitle("Nothing matches"),
				EmptyDescription(query.bind((term) => `No issues match \u201C${term.trim()}\u201D.`)),
			),
		),
	)
		.ElseIf(
			filters.bind((active) => active.length > 0),
			Empty(
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, ListFilter({ "aria-hidden": true })),
					EmptyTitle("No matching issues"),
					EmptyDescription("No issues match these filters."),
				),
				EmptyContent(
					Button(
						{ size: "sm", variant: "secondary", onClick: () => applyFilters([]) },
						"Clear filters",
					),
				),
			),
		)
		.ElseIf(
			// A tab can come up empty while the workspace is full of work, so
			// offer the way back out rather than claiming there is nothing. The
			// way out is All — the only tab that hides nothing, and the one the
			// default Active tab needs when the work in flight has run dry.
			view.bind((tab) => tab !== ALL_VIEW),
			Empty(
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, LayoutList({ "aria-hidden": true })),
					EmptyTitle(view.bind((tab) => `Nothing in ${ISSUE_VIEW_LABELS[tab]}`)),
					EmptyDescription("No issues sit in this view right now."),
				),
				EmptyContent(
					Button(
						{ size: "sm", variant: "secondary", onClick: () => applyView(ALL_VIEW) },
						`Show ${ISSUE_VIEW_LABELS[ALL_VIEW].toLowerCase()} issues`,
					),
				),
			),
		)
		.Else(
			Empty(
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, LayoutList({ "aria-hidden": true })),
					EmptyTitle("No issues yet"),
					EmptyDescription("Create the first issue to start tracking work."),
				),
				EmptyContent(
					Button(
						{
							size: "sm",
							variant: "secondary",
							onClick: () => openCreateIssue(params.slug.get(), data.get().team?.key),
						},
						Plus({ class: "size-3.5" }),
						"Create the first issue",
					),
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
	selected: ReturnType<typeof signal<string[]>>,
	anySelected: Readable<boolean>,
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
				SelectIssuesCheckbox({
					selected,
					issues: rows,
					label: `Select ${STATUS_LABELS[status]} issues`,
					class: "size-3.5",
				}),
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
				(issue) => IssueRow(issue, issues, data, params, hoveredId, rowMenu, selected, anySelected),
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
	selected: ReturnType<typeof signal<string[]>>,
	anySelected: Readable<boolean>,
) {
	const slug = params.slug;
	const id = issue.get().id;

	const update = (patch: Parameters<typeof patchIssue>[4], apply: (value: Issue) => Issue) =>
		void patchIssue(issues, slug.get(), id, issue.get().identifier, patch, apply);

	return Div(
		{
			class: [
				"row-hover group flex h-10 items-center gap-2 border-b border-border/40 px-4 text-[13px]",
				selected.bind((ids) => (ids.includes(id) ? "bg-accent/40" : "")),
			],
			onMouseenter: () => hoveredId.set(id),
			onMouseleave: () => hoveredId.set(null),
		},

		IssueCheckbox({
			checked: selected.bind((ids) => ids.includes(id)),
			onChange: (checked) =>
				selected.update((ids) =>
					checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((entry) => entry !== id),
				),
			label: `Select ${issue.get().identifier}`,
			class: rowCheckboxClass(anySelected),
		}),

		PriorityPicker(
			issue.bind("priority"),
			(priority) => update({ priority }, (value) => ({ ...value, priority })),
			{ open: menuOpen(rowMenu, id, "priority") },
		),

		Span(
			{ class: "hidden w-16 shrink-0 font-mono text-[12px] text-muted-foreground sm:block" },
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

		// A phone-width row keeps the essentials — priority, status, title,
		// assignee — and leaves the badge cluster to the issue page.
		Div(
			{ class: "hidden shrink-0 items-center gap-1 md:flex" },
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
			{ class: "hidden w-10 shrink-0 text-right text-[12px] text-muted-foreground sm:block" },
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
