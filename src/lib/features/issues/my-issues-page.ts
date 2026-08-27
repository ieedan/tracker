/**
 * My Issues — the workspace narrowed to one person, in three tabs.
 *
 *   - **Assigned** — what is on you. The default, because it is the question
 *     this screen exists to answer.
 *   - **Created** — what you filed, whoever ended up doing it.
 *   - **Subscribed** — what you are following: issues you commented on, issues
 *     assigned to you, and anything you pressed Subscribe on. See
 *     `issues.server.ts` for why that is a stored row rather than something
 *     inferred from participation.
 *
 * The tab is URL state under its own `tab` key, and the tabs are links — the
 * same arrangement the issue list's views use, and for the same reasons: a view
 * of your work is something you paste to someone, ⌘-click into a browser tab,
 * and get back to with the back button.
 *
 * All three slices come down with the load and the tabs switch between lists
 * already in hand. A search-only navigation does not re-run a kit load, so
 * slicing server-side per tab would have left the page showing the previous
 * tab's rows anyway — and one member's work in one workspace is small enough
 * that fetching all of it is cheaper than the round trip a tab click would
 * otherwise cost.
 */
import { router } from "$implement/router";
import {
	A,
	Div,
	Dynamic,
	ForEach,
	H1,
	If,
	Span,
	derived,
	navigateTo,
	type Readable,
} from "@implementjs/core";
import { Bell, CircleUser, FilePlus2 } from "@implementjs/lucide";
import { PriorityIcon, StatusIcon } from "@/lib/components/glyphs";
import { buttonVariants } from "@/lib/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import {
	ISSUE_STATUSES,
	PRIORITY_ORDER,
	STATUS_LABELS,
	type IssueStatus,
} from "@/lib/domain/issues";
import type { Issue, Workspace } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AssigneeAvatar, LabelChips, TeamBadge } from "./pickers";
import { PullRequestBadge } from "./pull-request-link";
import { RepositoryBadge } from "./repository-picker";

interface PageData {
	/** Assigned to you, in this workspace. */
	assigned: Issue[];
	/** Filed by you. */
	created: Issue[];
	/** Followed by you — see `listSubscribedIssues`. */
	subscribed: Issue[];
	workspace: Workspace;
}

export const MY_ISSUE_TABS = ["assigned", "created", "subscribed"] as const;
export type MyIssueTab = (typeof MY_ISSUE_TABS)[number];

export const MY_ISSUE_TAB_LABELS: Record<MyIssueTab, string> = {
	assigned: "Assigned",
	created: "Created",
	subscribed: "Subscribed",
};

/** What each tab says when it has nothing in it. */
const EMPTY_COPY: Record<MyIssueTab, { title: string; description: string }> = {
	assigned: {
		title: "Nothing assigned to you",
		description: "Issues put on you show up here.",
	},
	created: {
		title: "You have not filed anything",
		description: "Issues you create show up here, whoever picks them up.",
	},
	subscribed: {
		title: "You are not following anything",
		description:
			"Commenting on an issue follows it, and so does having one assigned to you. Subscribe on an issue does the rest.",
	},
};

/** The tab a bare `/app/:slug/my-issues` lands on. */
const DEFAULT_TAB: MyIssueTab = "assigned";

const TAB_PARAM = "tab";

/** Reads the tab out of a query string; anything unrecognised is the default. */
export function parseMyIssueTab(search: string): MyIssueTab {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	const raw = params.get(TAB_PARAM);
	return MY_ISSUE_TABS.find((tab) => tab === raw) ?? DEFAULT_TAB;
}

/** The URL a tab points at — this path, this tab, everything else untouched. */
function tabHref(location: { path: string; search: string }, tab: MyIssueTab): string {
	const params = new URLSearchParams(
		location.search.startsWith("?") ? location.search.slice(1) : location.search,
	);

	// The default tab is the absence of the key, so the plain link stays plain.
	if (tab === DEFAULT_TAB) params.delete(TAB_PARAM);
	else params.set(TAB_PARAM, tab);

	const query = params.toString();
	return `${location.path}${query === "" ? "" : `?${query}`}`;
}

export function MyIssuesPage({
	data,
	params,
	url,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
	url: Readable<{ path: string; search: string }>;
}) {
	// Derived from the URL rather than mirrored into a signal, so a reload, a
	// shared link and the back button all agree about which tab is open.
	const tab = derived([url], (location) => parseMyIssueTab(location.search));

	const visible = derived([data, tab], (value, current) => value[current]);

	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },

		Div(
			{
				class: "flex h-12 shrink-0 items-center gap-3 border-b border-border px-4",
			},
			H1({ class: "text-[15px] font-semibold tracking-tight" }, "My Issues"),
			Span(
				{ class: "rounded bg-secondary px-1.5 text-[11px] text-muted-foreground" },
				visible.bind((list) => `${list.length}`),
			),
		),

		TabRow(url, tab, data),

		Div(
			{ class: "min-h-0 flex-1 overflow-x-hidden overflow-y-auto" },
			If(
				visible.bind((list) => list.length === 0),
				EmptyState(tab),
			),
			...ISSUE_STATUSES.map((status) => StatusGroup(status, visible, params)),
		),
	);
}

/**
 * Assigned / Created / Subscribed, with a count on each.
 *
 * Links rather than buttons, and a plain left click is handled here so the page
 * switches in place — the same treatment `view-tabs.ts` gives the issue list's
 * views, so the two rows read as one idea across the app.
 */
function TabRow(
	url: Readable<{ path: string; search: string }>,
	current: Readable<MyIssueTab>,
	data: Readable<PageData>,
) {
	return Div(
		{
			class: "flex h-9 shrink-0 items-center gap-1 border-b border-border px-4",
			role: "tablist",
			"aria-label": "My issues",
		},
		...MY_ISSUE_TABS.map((tab) => {
			const href = url.bind((location) => tabHref(location, tab));
			const active = current.bind((value) => value === tab);
			const count = data.bind((value) => `${value[tab].length}`);

			return A(
				{
					href,
					role: "tab",
					"aria-selected": active,
					class: active.bind((on) =>
						cn(
							buttonVariants({ variant: "ghost", size: "sm" }),
							"h-7 gap-1.5 px-2 text-[12px] font-medium",
							on ? "bg-accent text-accent-foreground" : "text-muted-foreground",
						),
					),
					onClick: (event) => {
						// Let the browser have the clicks that mean "somewhere else".
						if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
						if (event.button !== 0) return;
						event.preventDefault();
						// Pushed, not replaced: a tab switch is a place you can go back
						// from. `noScroll` leaves a long list where it was.
						navigateTo(href.get(), { noScroll: true });
					},
				},
				MY_ISSUE_TAB_LABELS[tab],
				Span({ class: "text-[11px] text-muted-foreground" }, count),
			);
		}),
	);
}

/** The same status bands the issue list groups by, so the two lists scan alike. */
function StatusGroup(
	status: IssueStatus,
	visible: Readable<Issue[]>,
	params: { slug: Readable<string> },
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
				(issue) => IssueRow(issue, params),
			),
		),
	);
}

/**
 * One row, read-only.
 *
 * The issue list's rows carry pickers, because that list is where work gets
 * triaged in bulk. This one is a place you look things up from, so the same
 * fields are glyphs and text — status, identifier, title, the badge cluster,
 * when it last moved, and who owns it. Everything editable is one click away on
 * the issue itself.
 */
function IssueRow(issue: Readable<Issue>, params: { slug: Readable<string> }) {
	return Div(
		{
			class:
				"row-hover group flex h-10 items-center gap-2 border-b border-border/40 px-4 text-[13px]",
		},

		PriorityIcon(issue.bind("priority")),

		Span(
			{ class: "hidden w-16 shrink-0 font-mono text-[12px] text-muted-foreground sm:block" },
			issue.bind("identifier"),
		),

		StatusIcon(issue.bind("status")),

		router.Link(
			{
				to: "/app/:slug/issue/:identifier",
				params: { slug: params.slug, identifier: issue.bind("identifier") },
				class: "min-w-0 flex-1 truncate hover:underline",
			},
			issue.bind("title"),
		),

		// A phone-width row keeps the essentials and leaves the cluster to the
		// issue page, exactly as the main list does.
		Div(
			{ class: "hidden shrink-0 items-center gap-1 md:flex" },
			// Never a team route, so the badge always earns its place here.
			TeamBadge(issue.bind("team")),
			RepositoryBadge(issue.bind((value) => value.repository)),
			PullRequestBadge(issue.bind((value) => value.pullRequest)),
			LabelChips(issue.bind("labels")),
		),

		Span(
			{ class: "hidden w-10 shrink-0 text-right text-[12px] text-muted-foreground sm:block" },
			issue.bind((value) => relativeTime(value.updatedAt)),
		),

		AssigneeAvatar(issue.bind("assignee")),
	);
}

function tabIcon(tab: MyIssueTab) {
	switch (tab) {
		case "assigned":
			return CircleUser({ "aria-hidden": true });
		case "created":
			return FilePlus2({ "aria-hidden": true });
		case "subscribed":
			return Bell({ "aria-hidden": true });
	}
}

/** Which of the three tabs is empty, and what would put something in it. */
function EmptyState(tab: Readable<MyIssueTab>) {
	return Empty(
		EmptyHeader(
			// The node stays mounted across tab switches, so the glyph is swapped
			// rather than chosen once.
			EmptyMedia(
				{ variant: "icon" },
				Dynamic([tab], (current) => tabIcon(current)),
			),
			EmptyTitle(tab.bind((current) => EMPTY_COPY[current].title)),
			EmptyDescription(tab.bind((current) => EMPTY_COPY[current].description)),
		),
	);
}
