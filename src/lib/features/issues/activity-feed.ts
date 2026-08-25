/**
 * The issue's timeline.
 *
 * Comments and recorded changes are two tables and two endpoints, but one
 * story: "moved to In Progress, then asked a question, then reassigned" only
 * reads as a sequence if the two are interleaved. So they are merged here, by
 * timestamp, and a comment renders as a block while a change renders as a
 * single line — the difference in weight is what keeps the thread readable when
 * a busy issue collects thirty status moves.
 *
 * The first entry is synthesised rather than stored: the issue row already
 * knows who filed it and when, so "created the issue" needs no backfill for
 * every issue that predates the timeline.
 */
import {
	Div,
	Dynamic,
	ForEach,
	Fragment,
	If,
	Span,
	derived,
	type Child,
	type Readable,
} from "@implementjs/core";
import {
	AlignLeft,
	CircleDot,
	FolderGit2,
	GitPullRequest,
	Link2Off,
	Pencil,
	Tag,
	Users,
} from "@implementjs/lucide";
import { AgentBadge, PriorityIcon, StatusIcon, UserAvatar } from "@/lib/components/glyphs";
import { Markdown } from "@/lib/components/markdown";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_LABELS,
	STATUS_LABELS,
	type IssuePriority,
	type IssueStatus,
} from "@/lib/domain/issues";
import type { Activity, Comment, Issue } from "@/lib/domain/schemas";
import { AttachmentGrid } from "@/lib/features/attachments/attachment-list";
import { relativeTime } from "@/lib/format";

/**
 * One row of the timeline. A union would be tidier, but ForEach hands the
 * builder a signal of the whole row, and binding through a discriminated union
 * costs more casts than the two nullable fields do.
 */
interface TimelineRow {
	id: string;
	at: string;
	comment: Comment | null;
	activity: Activity | null;
}

export interface IssueTimelineProps {
	comments: Readable<Comment[]>;
	activity: Readable<Activity[]>;
	issue: Readable<Issue>;
	slug: Readable<string>;
}

export function IssueTimeline({ comments, activity, issue, slug }: IssueTimelineProps) {
	const rows = derived([comments, activity, issue], (commentList, activityList, current) => {
		const merged: TimelineRow[] = [
			{
				id: `created:${current.id}`,
				at: current.createdAt,
				comment: null,
				activity: {
					id: `created:${current.id}`,
					type: "created",
					actor: current.creator,
					from: null,
					to: null,
					labels: [],
					createdAt: current.createdAt,
				},
			},
			...activityList.map((entry) => ({
				id: entry.id,
				at: entry.createdAt,
				comment: null,
				activity: entry,
			})),
			...commentList.map((entry) => ({
				id: entry.id,
				at: entry.createdAt,
				comment: entry,
				activity: null,
			})),
		];

		return merged.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
	});

	return ForEach(
		rows,
		(row) => row.id,
		(row) =>
			// A row never changes which kind it is — its id is the comment's or the
			// entry's — so the branch is taken once, at build time.
			row.get().comment === null
				? ActivityRow(row.bind((value) => value.activity!))
				: CommentRow(
						row.bind((value) => value.comment!),
						slug,
					),
	);
}

function CommentRow(comment: Readable<Comment>, slug: Readable<string>) {
	return Div(
		{ class: "flex gap-3" },
		UserAvatar(comment.get().author, "mt-0.5"),
		Div(
			{ class: "min-w-0 flex-1" },
			Div(
				{ class: "flex items-baseline gap-2" },
				Span(
					{ class: "text-[13px] font-medium" },
					comment.bind((value) => value.author.name),
				),
				If(
					comment.bind((value) => value.author.type === "agent"),
					AgentBadge(),
				),
				Span(
					{ class: "text-[11px] text-muted-foreground" },
					comment.bind((value) => relativeTime(value.createdAt)),
				),
			),
			// Comment bodies are markdown; change events below are not. Only this
			// branch renders through it, so a status line stays one plain sentence.
			Markdown(comment.bind("body"), { class: "mt-0.5" }),
			AttachmentGrid({ attachments: comment.bind("attachments"), slug }),
		),
	);
}

function ActivityRow(activity: Readable<Activity>) {
	return Div(
		{ class: "flex items-center gap-3 text-[12px] text-muted-foreground" },
		Span(
			{ class: "flex size-5 shrink-0 items-center justify-center" },
			Dynamic([activity], (entry) => ActivityIcon(entry)),
		),
		Div(
			{ class: "flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5" },
			Span(
				{ class: "font-medium text-foreground" },
				activity.bind((entry) => entry.actor.name),
			),
			If(
				activity.bind((entry) => entry.actor.type === "agent"),
				AgentBadge(),
			),
			Dynamic([activity], (entry) => ActivitySentence(entry)),
			Span(
				{ class: "text-[11px] whitespace-nowrap" },
				activity.bind((entry) => relativeTime(entry.createdAt)),
			),
		),
	);
}

/** The value being talked about, set off from the surrounding sentence. */
function value(text: string): Child {
	return Span({ class: "font-medium text-foreground" }, text);
}

function LabelPill(label: { name: string; color: string }): Child {
	return Span(
		{
			class:
				"inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-foreground",
		},
		Span({ class: "size-2 shrink-0 rounded-full", style: { backgroundColor: label.color } }),
		label.name,
	);
}

function isStatus(candidate: string | null): candidate is IssueStatus {
	return candidate !== null && (ISSUE_STATUSES as readonly string[]).includes(candidate);
}

function isPriority(candidate: string | null): candidate is IssuePriority {
	return candidate !== null && (ISSUE_PRIORITIES as readonly string[]).includes(candidate);
}

/** Raw enum values are stored; this is what they read as. */
function statusText(candidate: string | null): string {
	return isStatus(candidate) ? STATUS_LABELS[candidate] : (candidate ?? "none");
}

function priorityText(candidate: string | null): string {
	return isPriority(candidate) ? PRIORITY_LABELS[candidate] : (candidate ?? "none");
}

function ActivitySentence(entry: Activity): Child {
	switch (entry.type) {
		case "created":
			return Span({}, "created the issue");

		case "status_changed":
			return entry.from === null
				? Fragment(Span({}, "set status to"), value(statusText(entry.to)))
				: Fragment(
						Span({}, "changed status from"),
						value(statusText(entry.from)),
						Span({}, "to"),
						value(statusText(entry.to)),
					);

		case "priority_changed":
			return entry.to === "none"
				? Span({}, "removed the priority")
				: Fragment(Span({}, "set priority to"), value(priorityText(entry.to)));

		case "assignee_changed":
			if (entry.to === null) {
				return Fragment(Span({}, "unassigned"), value(entry.from ?? "the issue"));
			}
			return entry.from === null
				? Fragment(Span({}, "assigned this to"), value(entry.to))
				: Fragment(
						Span({}, "reassigned this from"),
						value(entry.from),
						Span({}, "to"),
						value(entry.to),
					);

		case "title_changed":
			return Fragment(Span({}, "renamed this to"), value(entry.to ?? ""));

		case "description_changed":
			return Span({}, "updated the description");

		case "labels_changed": {
			const added = entry.labels.filter((label) => label.added);
			const removed = entry.labels.filter((label) => !label.added);
			return Fragment(
				...(added.length === 0 ? [] : [Span({}, "added"), ...added.map(LabelPill)]),
				...(removed.length === 0 ? [] : [Span({}, "removed"), ...removed.map(LabelPill)]),
			);
		}

		case "team_changed":
			return Fragment(
				Span({}, "moved this from"),
				value(entry.from ?? "another team"),
				Span({}, "to"),
				value(entry.to ?? ""),
			);

		case "repository_changed":
			return entry.to === null
				? Span({}, "unlinked the repository")
				: Fragment(Span({}, "scoped this to"), value(entry.to));

		case "pull_request_linked":
			return Fragment(Span({}, "linked pull request"), value(entry.to ?? ""));

		case "pull_request_unlinked":
			return Fragment(Span({}, "unlinked pull request"), value(entry.from ?? ""));
	}
}

function ActivityIcon(entry: Activity): Child {
	const muted = "size-3.5 text-muted-foreground";

	switch (entry.type) {
		case "status_changed":
			return isStatus(entry.to) ? StatusIcon(entry.to, "size-3.5") : CircleDot({ class: muted });
		case "priority_changed":
			return isPriority(entry.to)
				? PriorityIcon(entry.to, "size-3.5")
				: CircleDot({ class: muted });
		case "assignee_changed":
			return entry.actor.type === "agent"
				? UserAvatar(entry.actor, "size-4 text-[7px]")
				: CircleDot({ class: muted });
		case "title_changed":
			return Pencil({ class: muted });
		case "description_changed":
			return AlignLeft({ class: muted });
		case "labels_changed":
			return Tag({ class: muted });
		case "team_changed":
			return Users({ class: muted });
		case "repository_changed":
			return FolderGit2({ class: muted });
		case "pull_request_linked":
			return GitPullRequest({ class: muted });
		case "pull_request_unlinked":
			return Link2Off({ class: muted });
		case "created":
			return CircleDot({ class: muted });
	}
}
