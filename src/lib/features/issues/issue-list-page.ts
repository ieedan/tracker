import { router } from "$implement/router";
import {
	Div,
	ForEach,
	H1,
	If,
	ImplementDocument,
	ImplementLifecycle,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { LayoutList, ListFilter, Plus } from "@implementjs/lucide";
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

	// Tab first, then the filters within it. Searching the list is the command
	// palette's job — the header carries no box of its own.
	const visible = derived([issues, filters, view], (list, active, tab) => {
		const inView = list.filter((issue) => matchesView(issue, tab));
		return active.length === 0 ? inView : inView.filter((issue) => matchesFilters(issue, active));
	});

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

		// `c` opens the composer, `f` opens the filter menu — the Linear reflexes.
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

		Header(data, visible, selected),
		// The filter trigger rides at the right end of the tab row, the way
		// Linear's does; the chips for whatever it sets still land underneath.
		ViewTabs({
			url,
			actions: AddFilterButton(filters, filterContext, applyFilters, addFilterOpen, "icon"),
		}),
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
				EmptyState(params, data, filters, applyFilters, view, applyView),
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

/**
 * The list header: what you are looking at, and how much of it.
 *
 * Nothing else — the search box moved to the command palette, New issue to the
 * sidebar and the per-group plus, and Filter down onto the tab row. One line
 * that fits on a phone without wrapping, the way Linear's does.
 */
function Header(
	data: Readable<PageData>,
	visible: Readable<Issue[]>,
	selected: ReturnType<typeof signal<string[]>>,
) {
	return Div(
		{ class: "flex h-12 shrink-0 items-center gap-2 border-b border-border px-4" },
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
	);
}

function EmptyState(
	params: { slug: Readable<string> },
	data: Readable<PageData>,
	filters: Readable<Filter[]>,
	applyFilters: (next: Filter[]) => void,
	view: Readable<IssueView>,
	applyView: (next: IssueView) => void,
) {
	// "Nothing here" means three different things; say which one.
	return If(
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
			// way out is All issues — the only tab that hides nothing.
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
						`Show ${ISSUE_VIEW_LABELS[ALL_VIEW].toLowerCase()}`,
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

				// Linear's per-group plus: files straight into this band rather than
				// making you set the status afterwards. Always there, but muted
				// enough that a column of them does not read as a column of buttons.
				Button(
					{
						variant: "ghost",
						size: "icon-xs",
						class: "ml-auto text-muted-foreground hover:text-foreground",
						title: `New ${STATUS_LABELS[status].toLowerCase()} issue`,
						"aria-label": `New ${STATUS_LABELS[status].toLowerCase()} issue`,
						// `undefined` on the workspace list, where the composer picks the
						// team itself; the team key on a team route.
						onClick: () => openCreateIssue(params.slug.get(), data.get().team?.key, { status }),
					},
					Plus({ class: "size-3.5" }),
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
