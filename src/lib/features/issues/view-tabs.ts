/**
 * The view tabs — Linear's Active / Backlog / All issues, in a row of their own
 * between the list header and the filter chips, with the filter control out at
 * the right end of the same row.
 *
 * They are links rather than buttons because the tab is URL state (see
 * `filters.ts`): the address bar is always something you can paste to someone,
 * and ⌘-click opens that view in a new browser tab. A plain left click is
 * handled here so the list navigates in place instead of reloading, the same
 * way the router's own `Link` does it.
 *
 * The row reads as text, not as a control: subdued labels, and the selected one
 * lifted with the shell's `accent` chip — the same treatment the inbox gives
 * its All / Unread pair, so the two rows look like one idea.
 */
import { A, Div, navigateTo, type Child, type Readable } from "@implementjs/core";
import { buttonVariants } from "@/lib/components/ui/button";
import { cn } from "@/lib/utils";
import { ISSUE_VIEW_LABELS, ISSUE_VIEWS, parseView, viewHref, type IssueView } from "./filters";

/** Where the list is: what the tabs read themselves out of and link back into. */
export type ViewLocation = { path: string; search: string };

/**
 * The tab row. `actions` sits at the far right of it — Linear puts the filter
 * control on this line rather than in the header above, where it would compete
 * with the view's name.
 */
export function ViewTabs({ url, actions }: { url: Readable<ViewLocation>; actions?: Child }) {
	// Derived from the URL rather than mirrored into a signal, exactly like the
	// filters — so a reload, a shared link and the back button all agree.
	const current = url.bind((location) => parseView(location.search));

	return Div(
		{
			class: "flex h-9 shrink-0 items-center gap-1 border-b border-border px-4",
			role: "tablist",
			"aria-label": "Issue views",
		},
		...ISSUE_VIEWS.map((view) => ViewTab(view, url, current)),
		actions === undefined ? null : Div({ class: "ml-auto flex items-center gap-1" }, actions),
	);
}

function ViewTab(view: IssueView, url: Readable<ViewLocation>, current: Readable<IssueView>) {
	const href = url.bind((location) => viewHref(location, view));
	const active = current.bind((value) => value === view);

	return A(
		{
			href,
			role: "tab",
			"aria-selected": active,
			class: active.bind((on) =>
				cn(
					buttonVariants({ variant: "ghost", size: "sm" }),
					"h-7 px-2 text-[12px] font-medium",
					on ? "bg-accent text-accent-foreground" : "text-muted-foreground",
				),
			),
			onClick: (event) => {
				// Let the browser have the clicks that mean "somewhere else".
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				if (event.button !== 0) return;
				event.preventDefault();
				// Pushed, not replaced: a tab switch is a place you can go back
				// from, unlike fiddling with a filter. `noScroll` leaves a long
				// list where it was.
				navigateTo(href.get(), { noScroll: true });
			},
		},
		ISSUE_VIEW_LABELS[view],
	);
}
