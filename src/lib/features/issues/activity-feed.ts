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
	ImplementLifecycle,
	Span,
	derived,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import {
	AlignLeft,
	CircleDot,
	Copy,
	Ellipsis,
	FolderGit2,
	GitPullRequest,
	Link2Off,
	Pencil,
	Tag,
	Trash2,
	Users,
} from "@implementjs/lucide";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { AgentBadge, PriorityIcon, StatusIcon, UserAvatar } from "@/lib/components/glyphs";
import { Markdown } from "@/lib/components/markdown";
import { Button } from "@/lib/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { Textarea } from "@/lib/components/ui/textarea";
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

/**
 * What a comment row may do to its comment. The handlers own the request and
 * the list update; the row only reports whether to leave its edit or confirm
 * state up when one fails.
 */
export interface CommentActions {
	/** The signed-in user — Edit and Delete only show on their own comments. */
	viewerId: Readable<string>;
	/** Admins may delete anyone's comment. Editing stays with the author. */
	isAdmin: Readable<boolean>;
	onEdit: (id: string, body: string) => Promise<boolean>;
	onDelete: (id: string) => Promise<boolean>;
}

export interface IssueTimelineProps {
	comments: Readable<Comment[]>;
	activity: Readable<Activity[]>;
	issue: Readable<Issue>;
	slug: Readable<string>;
	actions: CommentActions;
}

export function IssueTimeline({ comments, activity, issue, slug, actions }: IssueTimelineProps) {
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
						actions,
					),
	);
}

/**
 * Creation stamps both timestamps in one go, so a gap between them can only
 * mean an edit. The tolerance absorbs the two `new Date()` calls the insert
 * makes without swallowing any real edit, which is a request away at least.
 */
function wasEdited(value: Comment): boolean {
	return Date.parse(value.updatedAt) - Date.parse(value.createdAt) > 1000;
}

function CommentRow(comment: Readable<Comment>, slug: Readable<string>, actions: CommentActions) {
	const editing = signal(false);
	const draft = signal("");
	const draftRef = signal<HTMLTextAreaElement | null>(null);
	const saving = signal(false);
	const confirmingDelete = signal(false);

	const isAuthor = derived([actions.viewerId, comment], (id, value) => value.author.id === id);
	const canDelete = derived([isAuthor, actions.isAdmin], (author, admin) => author || admin);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(comment.get().body);
			toastSuccess("Copied to clipboard");
		} catch {
			toastError("Could not copy. Select and copy manually.");
		}
	};

	const beginEdit = () => {
		draft.set(comment.get().body);
		editing.set(true);
	};

	const save = async () => {
		const next = draft.get().trim();
		if (next === "" || saving.get()) return;
		if (next === comment.get().body) {
			editing.set(false);
			return;
		}
		saving.set(true);
		const done = await actions.onEdit(comment.get().id, next);
		saving.set(false);
		// A refused save keeps the box up: the words are still only in it.
		if (done) editing.set(false);
	};

	return Div(
		{ class: "group/comment flex gap-3" },
		UserAvatar(comment.get().author, "mt-0.5"),
		Div(
			{ class: "min-w-0 flex-1" },
			Div(
				{ class: "flex items-center gap-2" },
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
				If(
					comment.bind(wasEdited),
					Span(
						{
							class: "text-[11px] text-muted-foreground",
							title: comment.bind((value) => `Edited ${relativeTime(value.updatedAt)}`),
						},
						"(edited)",
					),
				),
				CommentMenu({
					isAuthor,
					canDelete,
					onCopy: () => void copy(),
					onEdit: beginEdit,
					onDelete: () => confirmingDelete.set(true),
				}),
			),
			If(editing)
				.Then(
					// Focus is taken on mount rather than through `autofocus` — the
					// attribute is honoured once per document, and this box appears
					// well after the page has spent it.
					ImplementLifecycle({
						onMount: () => {
							const node = draftRef.get();
							if (node === null) return;
							node.focus();
							node.setSelectionRange(node.value.length, node.value.length);
						},
					}),
					// A plain box holding the raw markdown — the same source the
					// composer took, handed back to be reworded.
					Div(
						{ class: "mt-1.5 flex flex-col gap-2" },
						Textarea({
							this: draftRef,
							value: draft,
							rows: 3,
							class: "max-h-64 text-[13px]",
							onKeydown: (event) => {
								if (event.key === "Escape") editing.set(false);
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
							},
						}),
						Div(
							{ class: "flex justify-end gap-2" },
							Button(
								{
									size: "sm",
									variant: "secondary",
									disabled: saving,
									onClick: () => editing.set(false),
								},
								"Cancel",
							),
							Button(
								{
									size: "sm",
									loading: saving,
									disabled: draft.bind((value) => value.trim() === ""),
									onClick: () => void save(),
								},
								"Save",
							),
						),
					),
				)
				.Else(
					// Comment bodies are markdown; change events below are not. Only this
					// branch renders through it, so a status line stays one plain sentence.
					Markdown(comment.bind("body"), { class: "mt-0.5" }),
				),
			AttachmentGrid({ attachments: comment.bind("attachments"), slug }),
			DeleteCommentDialog({
				open: confirmingDelete,
				onConfirm: () => actions.onDelete(comment.get().id),
			}),
		),
	);
}

/** The row's "…": Copy for everyone, Edit and Delete only where they apply. */
function CommentMenu(props: {
	isAuthor: Readable<boolean>;
	canDelete: Readable<boolean>;
	onCopy: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return Div(
		{ class: "ml-auto" },
		DropdownMenu(
			DropdownMenuTrigger(
				{
					variant: "ghost",
					size: "icon",
					class:
						"size-6 text-muted-foreground opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
					"aria-label": "Comment actions",
				},
				Ellipsis({ class: "size-3.5" }),
			),
			DropdownMenuContent(
				{ class: "w-36", align: "end" },
				DropdownMenuItem({ onSelect: props.onCopy }, Copy({ class: "size-3.5" }), "Copy text"),
				If(
					props.isAuthor,
					DropdownMenuItem({ onSelect: props.onEdit }, Pencil({ class: "size-3.5" }), "Edit"),
				),
				If(
					props.canDelete,
					DropdownMenuItem(
						{
							class: "text-destructive data-[highlighted]:text-destructive",
							onSelect: props.onDelete,
						},
						Trash2({ class: "size-3.5" }),
						"Delete",
					),
				),
			),
		),
	);
}

/** The same shape as deleting an issue: name the loss, one destructive button. */
function DeleteCommentDialog(props: {
	open: ReturnType<typeof signal<boolean>>;
	onConfirm: () => Promise<boolean>;
}) {
	const deleting = signal(false);

	const confirm = async () => {
		if (deleting.get()) return;
		deleting.set(true);
		const done = await props.onConfirm();
		deleting.set(false);
		if (done) props.open.set(false);
	};

	return Dialog(
		{ open: props.open },
		DialogContent(
			{ class: "max-w-md gap-0 p-0" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle({ class: "text-[15px] font-semibold" }, "Delete comment"),
				DialogDescription(
					{ class: "text-[12px]" },
					"This cannot be undone. The comment and its attachments are deleted for everyone in the workspace.",
				),
			),
			Div(
				{ class: "flex justify-end gap-2 px-4 py-3" },
				Button(
					{
						size: "sm",
						variant: "secondary",
						disabled: deleting,
						onClick: () => props.open.set(false),
					},
					"Cancel",
				),
				Button(
					{ size: "sm", variant: "destructive", loading: deleting, onClick: () => void confirm() },
					"Delete comment",
				),
			),
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
