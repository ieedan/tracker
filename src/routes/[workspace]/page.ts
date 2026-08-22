import { router } from "$implement/router";
import {
	Div,
	ForEach,
	H1,
	If,
	Implement,
	Span,
	derived,
	signal,
} from "@implementjs/core";
import { ListIcon, SearchIcon, XIcon } from "@implementjs/lucide";
import { api } from "@/lib/api";
import { createDisplayOptions, DisplayMenu } from "@/lib/components/display-menu";
import {
	createIssueFilters,
	FilterChips,
	FilterMenu,
	filterOptions,
} from "@/lib/components/filter-bar";
import { IssueRow, UserAvatar } from "@/lib/components/issue-row";
import { PriorityIcon } from "@/lib/components/priority-icon";
import { StatusIcon } from "@/lib/components/status-icon";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { groupIssues, type IssueGroup } from "@/lib/issue-view";
import { WorkspaceContext } from "@/lib/workspace-context";
import type { IssueDto, RepoDto, StatusDto, UserDto } from "@/lib/types";
import type { PageProps } from "./$types";

/**
 * The issue list.
 *
 * The header follows Linear's shape: the view's name on the left, the controls
 * that change the view on the right, and a second row that only exists once
 * you have narrowed something.
 */
export default function Page({ data }: PageProps) {
	return WorkspaceContext.Use((store) => {
		const searchParam = router.searchParam("q", "");

		const issues = signal<IssueDto[]>(data.get().page.items);
		const loading = signal(false);
		const filters = createIssueFilters();
		const display = createDisplayOptions();
		const options = filterOptions(store, store.members);
		const query = signal(searchParam.get());
		/** The search field is revealed rather than always present, as in Linear. */
		const searchOpen = signal(false);
		const searchInput = signal<HTMLInputElement | null>(null);
		/** Index into the flattened, grouped list — what j/k move. */
		const cursor = signal(-1);

		let inFlight = 0;
		const refetch = async () => {
			const ticket = ++inFlight;
			loading.set(true);
			try {
				const page = await api.issues.list(store.workspace.get().slug, {
					status: filters.status.get(),
					priority: filters.priority.get().map(Number).filter(Number.isInteger),
					label: filters.label.get(),
					repo: filters.repo.get(),
					assignee: filters.assignee.get(),
					q: query.get(),
					limit: 200,
				});
				// A slower earlier request must not overwrite a faster later one.
				if (ticket === inFlight) issues.set(page.items);
			} finally {
				if (ticket === inFlight) loading.set(false);
			}
		};

		const groups = derived(
			[issues, store.statuses, display.grouping, display.ordering],
			(all, statuses, grouping, ordering) => groupIssues(all, statuses, grouping, ordering),
		);

		/** The same list, flattened, so keyboard navigation has one index space. */
		const flat = derived([groups], (all) => all.flatMap((group) => group.items));

		const move = (delta: number) => {
			const total = flat.get().length;
			if (total === 0) return;
			cursor.set(Math.min(Math.max(cursor.get() + delta, 0), total - 1));
		};

		return Div(
			{ class: "flex min-h-0 flex-1 flex-col" },

			filters.Sync,
			display.Sync,

			// A navigation between workspaces reseeds this page rather than
			// remounting it, so the list follows `data` rather than reading it once.
			Implement.Watch([data], (next) => issues.set(next.page.items)),

			// Refetching is driven from here rather than from each control, so
			// there is one place that decides what a change costs. The text box is
			// debounced; ticking a checkbox is not. Grouping and ordering are not
			// here at all — they rearrange what is already loaded.
			Implement.Lifecycle({
				onMount: () => {
					// The server data can only be trusted for the unfiltered view.
					// Kit fetches `__data.json` without the query string, and skips
					// the fetch entirely when only the query changed, so arriving at
					// a filtered URL from another page lands unfiltered data here.
					// Re-reading once when the URL carries filters costs a request
					// only on the views that need it.
					if (query.get() !== "" || filters.all.some((values) => values.get().length > 0)) {
						void refetch();
					}

					let debounce: ReturnType<typeof setTimeout> | undefined;
					const unsubscribes = [
						...filters.all.map((dimension) => dimension.onChange(() => void refetch())),
						query.onChange((text) => {
							clearTimeout(debounce);
							searchParam.set(text);
							debounce = setTimeout(() => void refetch(), 200);
						}),
					];

					return () => {
						clearTimeout(debounce);
						for (const unsubscribe of unsubscribes) unsubscribe();
					};
				},
			}),

			// Every change in the workspace lands here, whoever made it.
			Implement.Lifecycle({
				onMount: () =>
					store.on((event) => {
						if (event.type === "issue.created") {
							issues.set([event.issue, ...issues.get().filter((i) => i.id !== event.issue.id)]);
						} else if (event.type === "issue.updated") {
							issues.set(issues.get().map((i) => (i.id === event.issue.id ? event.issue : i)));
						} else if (event.type === "issue.deleted") {
							issues.set(issues.get().filter((i) => i.id !== event.issueId));
						}
					}),
			}),

			Implement.Document({
				onKeydown: (event) => {
					const target = event.target as HTMLElement | null;
					// Never steal a keystroke aimed at a field.
					if (
						target !== null &&
						(target.isContentEditable ||
							["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
					) {
						return;
					}
					if (event.metaKey || event.ctrlKey || event.altKey) return;

					if (event.key === "j") {
						event.preventDefault();
						move(1);
					} else if (event.key === "k") {
						event.preventDefault();
						move(-1);
					}
				},
			}),

			/* ------------------------------ the header ------------------------------ */

			Div(
				{ class: "flex h-11 shrink-0 items-center gap-2 border-b px-4" },

				ListIcon({ class: "size-4 shrink-0 text-muted-foreground" }),
				H1({ class: "text-sm font-medium" }, "All issues"),
				Span(
					{ class: "text-xs text-muted-foreground" },
					flat.bind((all) => `${all.length}`),
				),

				Div(
					{ class: "ml-auto flex items-center gap-1" },

					If(derived([searchOpen, query], (open, text) => open || text !== ""))
						.Then(
							Div(
								{ class: "flex items-center gap-1 rounded-md border px-2" },
								// Focus only when the field was opened deliberately — a
								// page loaded from a URL that already carries `?q=` should
								// not steal the caret.
								Implement.Lifecycle({
									onMount: () => {
										if (searchOpen.get()) searchInput.get()?.focus();
									},
								}),
								SearchIcon({ class: "size-3.5 shrink-0 text-muted-foreground" }),
								Input({
									this: searchInput,
									value: query,
									placeholder: "Search issues…",
									"aria-label": "Search issues",
									class:
										"h-7 w-44 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0",
									onKeydown: (event) => {
										if (event.key !== "Escape") return;
										query.set("");
										searchOpen.set(false);
									},
								}),
								Button(
									{
										variant: "ghost",
										size: "icon-xs",
										"aria-label": "Clear search",
										title: "Clear search",
										onClick: () => {
											query.set("");
											searchOpen.set(false);
										},
									},
									XIcon({ class: "size-3" }),
								),
							),
						)
						.Else(
							Button(
								{
									variant: "ghost",
									size: "icon-sm",
									class: "size-7 text-muted-foreground",
									"aria-label": "Search issues",
									title: "Search",
									onClick: () => searchOpen.set(true),
								},
								SearchIcon({ class: "size-4" }),
							),
						),

					If(loading).Then(
						Span({ class: "text-xs text-muted-foreground", role: "status" }, "…"),
					),
					LiveDot(store.live),
					FilterMenu(filters, options),
					DisplayMenu(display),
				),
			),

			FilterChips(filters, options),

			/* ------------------------------- the list ------------------------------- */

			Div(
				{ class: "min-h-0 flex-1 overflow-y-auto" },

				If(flat.bind((all) => all.length === 0)).Then(
					Div(
						{ class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
						Span({ class: "text-sm font-medium" }, "Nothing here"),
						Span(
							{ class: "text-sm text-muted-foreground" },
							derived([query, ...filters.all], (text, ...selected) => {
								if (selected.some((values) => values.length > 0)) {
									return "No issues match these filters.";
								}
								return text === ""
									? "Press c to create the first issue."
									: `No issues match “${text}”.`;
							}),
						),
					),
				),

				ForEach(
					groups,
					(group) => group.key,
					(group) =>
						Div(
							If(group.bind((value) => value.kind !== "none")).Then(
								Div(
									{
										class:
											"sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-1.5 backdrop-blur",
									},
									GroupGlyph(group.get()),
									Span({ class: "text-sm font-medium" }, group.bind("label")),
									Span(
										{ class: "text-xs text-muted-foreground" },
										group.bind((value) => `${value.items.length}`),
									),
								),
							),
							ForEach(
								group.bind("items"),
								(issue) => issue.id,
								(issue) =>
									IssueRow({
										issue,
										workspace: store.workspace.get().slug,
										active: derived(
											[cursor, flat],
											(index, all) => all[index]?.id === issue.get().id,
										),
										onFocus: () =>
											cursor.set(flat.get().findIndex((i) => i.id === issue.get().id)),
									}),
							),
						),
				),
			),
		);
	});
}

/** The glyph for a group header, which depends on what the list is grouped by. */
function GroupGlyph(group: IssueGroup) {
	if (group.kind === "status") return StatusIcon(group.subject as StatusDto);
	if (group.kind === "priority") return PriorityIcon(group.subject as 0 | 1 | 2 | 3 | 4);
	if (group.kind === "assignee") return UserAvatar(group.subject as UserDto | null, "size-4");
	if (group.kind === "repo") {
		return Span({
			class: (group.subject as RepoDto | null) === null
				? "size-2 rounded-full bg-muted-foreground/30"
				: "size-2 rounded-full bg-muted-foreground/60",
		});
	}
	return Span({ class: "size-4" });
}

/** Filled while the event stream is connected, hollow when it isn't. */
function LiveDot(live: ReturnType<typeof signal<boolean>>) {
	return Span({
		class: live.bind((connected) =>
			connected
				? "mr-1 size-1.5 rounded-full bg-emerald-500"
				: "mr-1 size-1.5 rounded-full border border-muted-foreground",
		),
		title: live.bind((connected) => (connected ? "Live" : "Reconnecting…")),
		role: "status",
		"aria-label": live.bind((connected) =>
			connected ? "Live updates connected" : "Live updates reconnecting",
		),
	});
}
