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
} from "@implementjs/core";
import { Plus, Search } from "@implementjs/lucide";
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
import { AssigneePicker, LabelChips, PriorityPicker, StatusPicker, TeamBadge } from "./pickers";
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
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
}) {
	const issues = signal(data.get().issues);
	// A client navigation between workspaces reseeds the load rather than
	// remounting the page, so the local list has to follow `data`.
	data.onChange((next) => issues.set(next.issues));

	const query = signal("");

	const visible = derived([issues, query], (list, term) => {
		const needle = term.trim().toLowerCase();
		if (needle === "") return list;
		return list.filter(
			(issue) =>
				issue.title.toLowerCase().includes(needle) ||
				issue.identifier.toLowerCase().includes(needle),
		);
	});

	const searchRef = signal<HTMLInputElement | null>(null);

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
				if (event.key === "c" && !event.metaKey && !event.ctrlKey) {
					event.preventDefault();
					openCreateIssue(params.slug.get(), data.get().team?.key);
				}
				if (event.key === "/") {
					event.preventDefault();
					searchRef.get()?.focus();
				}
			},
		}),

		Header(data, query, searchRef, params),

		Div(
			{ class: "min-h-0 flex-1 overflow-y-auto" },
			If(
				visible.bind((list) => list.length === 0),
				EmptyState(query, params, data),
			),
			...ISSUE_STATUSES.map((status) => StatusGroup(status, visible, issues, data, params)),
		),
	);
}

function Header(
	data: Readable<PageData>,
	query: ReturnType<typeof signal<string>>,
	searchRef: ReturnType<typeof signal<HTMLInputElement | null>>,
	params: { slug: Readable<string> },
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
			data.bind((value) => `${value.issues.length}`),
		),

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
) {
	return Div(
		{ class: "flex flex-col items-center justify-center gap-3 py-24 text-center" },
		Div(
			{ class: "text-[13px] text-muted-foreground" },
			query.bind((term) => (term.trim() === "" ? "No issues yet." : `Nothing matches “${term}”.`)),
		),
		If(
			query.bind((term) => term.trim() === ""),
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
				(issue) => IssueRow(issue, issues, data, params),
			),
		),
	);
}

function IssueRow(
	issue: Readable<Issue>,
	issues: ReturnType<typeof signal<Issue[]>>,
	data: Readable<PageData>,
	params: { slug: Readable<string> },
) {
	const slug = params.slug;
	const id = issue.get().id;

	const update = (patch: Parameters<typeof patchIssue>[4], apply: (value: Issue) => Issue) =>
		void patchIssue(issues, slug.get(), id, issue.get().identifier, patch, apply);

	return Div(
		{
			class:
				"row-hover group flex h-10 items-center gap-2 border-b border-border/40 px-4 text-[13px]",
		},

		PriorityPicker(issue.bind("priority"), (priority) =>
			update({ priority }, (value) => ({ ...value, priority })),
		),

		Span(
			{ class: "w-16 shrink-0 font-mono text-[12px] text-muted-foreground" },
			issue.bind("identifier"),
		),

		StatusPicker(issue.bind("status"), (status) =>
			update({ status }, (value) => ({ ...value, status })),
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
		),
	);
}

/** True when the key event came from a field, so shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
