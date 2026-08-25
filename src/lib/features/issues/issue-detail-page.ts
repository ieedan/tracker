import { router } from "$implement/router";
import {
	Div,
	ForEach,
	H1,
	If,
	Input,
	P,
	Span,
	Textarea,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import { ChevronLeft } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { UserAvatar } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import type {
	Attachment,
	Comment,
	Issue,
	Label,
	Member,
	Team,
	Workspace,
} from "@/lib/domain/schemas";
import {
	AttachmentGrid,
	DropZone,
	removeAttachment,
} from "@/lib/features/attachments/attachment-list";
import type { Upload } from "@/lib/features/attachments/uploader";
import { fullTime, relativeTime } from "@/lib/format";
import {
	AssigneePicker,
	LabelChips,
	LabelPicker,
	PriorityPicker,
	StatusPicker,
	TeamPicker,
} from "./pickers";
import { patchIssue } from "./issue-store";

interface PageData {
	issue: Issue;
	attachments: Attachment[];
	comments: Comment[];
	workspace: Workspace;
	teams: Team[];
	members: Member[];
	labels: Label[];
}

export function IssueDetailPage({
	data,
	params,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string>; identifier: Readable<string> };
}) {
	// `patchIssue` works over a list, so the detail page keeps a list of one.
	const issues = signal<Issue[]>([data.get().issue]);
	data.onChange((next) => issues.set([next.issue]));
	const issue = issues.bind((list) => list[0]!);

	const comments = signal(data.get().comments);
	data.onChange((next) => comments.set(next.comments));

	const attachments = signal(data.get().attachments);
	data.onChange((next) => attachments.set(next.attachments));
	const uploads = signal<Upload[]>([]);

	const update = (patch: Parameters<typeof patchIssue>[4], apply: (value: Issue) => Issue) =>
		void patchIssue(
			issues,
			params.slug.get(),
			data.get().issue.id,
			data.get().issue.identifier,
			patch,
			apply,
		);

	// Moving teams renumbers the issue, so the URL it lives at changes with it.
	const moveTeam = (key: string) => {
		const destination = data.get().teams.find((team) => team.key === key);
		if (destination === undefined || destination.id === issue.get().team.id) return;

		void patchIssue(
			issues,
			params.slug.get(),
			data.get().issue.id,
			data.get().issue.identifier,
			{ teamKey: key },
			(value) => ({ ...value, team: destination }),
		).then((moved) => {
			if (moved !== undefined) {
				router.navigate("/app/:slug/issue/:identifier", {
					slug: params.slug.get(),
					identifier: moved.identifier,
				});
			}
		});
	};

	return Div(
		{ class: "flex min-h-0 flex-1" },

		Div(
			{ class: "flex min-w-0 flex-1 flex-col" },
			Div(
				{ class: "flex h-12 shrink-0 items-center gap-2 border-b border-border px-4" },
				router.Link(
					{
						to: "/app/:slug",
						params: { slug: params.slug },
						class:
							"flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground",
					},
					ChevronLeft({ class: "size-3.5" }),
					"Issues",
				),
				Span({ class: "text-muted-foreground" }, "/"),
				Span({ class: "font-mono text-[12px] text-muted-foreground" }, issue.bind("identifier")),
			),

			Div(
				{ class: "min-h-0 flex-1 overflow-y-auto px-8 py-6" },
				Div(
					{ class: "mx-auto flex max-w-3xl flex-col gap-6" },
					EditableTitle(issue, update),
					EditableDescription(issue, update),

					// The whole body is the drop target, not just a small well —
					// dragging a screenshot onto the issue is the gesture people try.
					DropZone({
						target: { slug: params.slug, issueId: data.get().issue.id },
						uploads,
						onUploaded: (attachment) => attachments.push(attachment),
						children: AttachmentGrid({
							attachments,
							uploads,
							slug: params.slug,
							onRemove: (attachment) =>
								void removeAttachment(params.slug.get(), attachment, attachments),
						}),
					}),

					CommentThread(comments, params),
				),
			),
		),

		// Linear puts the properties in a right rail rather than above the body.
		Div(
			{ class: "hidden w-64 shrink-0 flex-col gap-4 border-l border-border p-4 lg:flex" },
			PropertyRow(
				"Team",
				TeamPicker(
					issue.bind("team"),
					data.bind((value) => value.teams),
					moveTeam,
					{ showLabel: true },
				),
			),
			PropertyRow(
				"Status",
				StatusPicker(
					issue.bind("status"),
					(status) => update({ status }, (value) => ({ ...value, status })),
					{ showLabel: true },
				),
			),
			PropertyRow(
				"Priority",
				PriorityPicker(
					issue.bind("priority"),
					(priority) => update({ priority }, (value) => ({ ...value, priority })),
					{ showLabel: true },
				),
			),
			PropertyRow(
				"Assignee",
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
					{ showLabel: true },
				),
			),
			PropertyRow(
				"Labels",
				Div(
					{ class: "flex flex-col items-start gap-1.5" },
					// The picker's trigger only counts them; the chips say which.
					Div({ class: "flex flex-wrap gap-1" }, LabelChips(issue.bind("labels"))),
					LabelPicker(
						issue.bind("labels"),
						data.bind((value) => value.labels),
						(labelId) =>
							update(
								{
									labelIds: toggle(
										issue.get().labels.map((label) => label.id),
										labelId,
									),
								},
								(value) => ({
									...value,
									labels: value.labels.some((label) => label.id === labelId)
										? value.labels.filter((label) => label.id !== labelId)
										: [...value.labels, data.get().labels.find((label) => label.id === labelId)!],
								}),
							),
					),
				),
			),

			Div(
				{ class: "mt-2 border-t border-border pt-3 text-[11px] text-muted-foreground" },
				P(
					{},
					issue.bind((value) => `Created ${fullTime(value.createdAt)}`),
				),
				P(
					{},
					issue.bind((value) => `by ${value.creator.name}`),
				),
			),
		),
	);
}

function toggle(ids: string[], id: string): string[] {
	return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

function PropertyRow(label: string, control: Child) {
	return Div(
		{ class: "flex items-center gap-2" },
		Span({ class: "w-16 shrink-0 text-[12px] text-muted-foreground" }, label),
		Div({ class: "min-w-0 flex-1" }, control),
	);
}

/** Click the heading, edit it, Enter or blur commits; Escape abandons. */
function EditableTitle(
	issue: Readable<Issue>,
	update: (patch: { title: string }, apply: (value: Issue) => Issue) => void,
) {
	const editing = signal(false);
	const draft = signal("");

	const commit = () => {
		const next = draft.get().trim();
		editing.set(false);
		if (next === "" || next === issue.get().title) return;
		update({ title: next }, (value) => ({ ...value, title: next }));
	};

	return If(editing)
		.Then(
			Input({
				value: draft,
				autofocus: true,
				class:
					"w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight outline-none",
				onBlur: commit,
				onKeydown: (event) => {
					if (event.key === "Enter") commit();
					if (event.key === "Escape") editing.set(false);
				},
			}),
		)
		.Else(
			H1(
				{
					class: "cursor-text text-2xl font-semibold tracking-tight",
					title: "Click to edit",
					onClick: () => {
						draft.set(issue.get().title);
						editing.set(true);
					},
				},
				issue.bind("title"),
			),
		);
}

function EditableDescription(
	issue: Readable<Issue>,
	update: (patch: { description: string }, apply: (value: Issue) => Issue) => void,
) {
	const editing = signal(false);
	const draft = signal("");

	const commit = () => {
		const next = draft.get();
		editing.set(false);
		if (next === issue.get().description) return;
		update({ description: next }, (value) => ({ ...value, description: next }));
	};

	return If(editing)
		.Then(
			Textarea({
				value: draft,
				autofocus: true,
				rows: 8,
				class:
					"w-full resize-y rounded-md border border-input bg-background p-3 text-[14px] outline-none focus:border-ring",
				onKeydown: (event) => {
					if (event.key === "Escape") editing.set(false);
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit();
				},
				onBlur: commit,
			}),
		)
		.Else(
			Div(
				{
					class:
						"cursor-text rounded-md py-1 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90 hover:bg-accent/40",
					onClick: () => {
						draft.set(issue.get().description);
						editing.set(true);
					},
				},
				issue.bind((value) =>
					value.description.trim() === "" ? "Add a description…" : value.description,
				),
			),
		);
}

function CommentThread(
	comments: ReturnType<typeof signal<Comment[]>>,
	params: { slug: Readable<string>; identifier: Readable<string> },
) {
	const draft = signal("");
	const posting = signal(false);

	const post = async () => {
		const body = draft.get().trim();
		if (body === "") return;

		posting.set(true);
		const { data, error } = await api.POST(
			"/api/v1/workspaces/[slug]/issues/[identifier]/comments",
			{
				params: { slug: params.slug.get(), identifier: params.identifier.get() },
				body: { body },
			},
		);
		posting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not post the comment"));
			return;
		}
		comments.push(data);
		draft.set("");
	};

	return Div(
		{ class: "flex flex-col gap-4 border-t border-border pt-6" },
		Span({ class: "text-[13px] font-medium" }, "Comments"),

		ForEach(
			comments,
			(comment) => comment.id,
			(comment) =>
				Div(
					{ class: "flex gap-3" },
					UserAvatar(comment.get().author, "mt-0.5"),
					Div(
						{ class: "min-w-0 flex-1" },
						Div(
							{ class: "flex items-baseline gap-2" },
							Span(
								{ class: "text-[13px] font-medium" },
								comment.bind((c) => c.author.name),
							),
							Span(
								{ class: "text-[11px] text-muted-foreground" },
								comment.bind((c) => relativeTime(c.createdAt)),
							),
						),
						P({ class: "text-[13px] leading-relaxed whitespace-pre-wrap" }, comment.bind("body")),
					),
				),
		),

		Div(
			{ class: "flex flex-col gap-2 rounded-md border border-border p-3" },
			Textarea({
				value: draft,
				rows: 3,
				placeholder: "Leave a comment…",
				class:
					"resize-none border-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground",
				onKeydown: (event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void post();
				},
			}),
			Div(
				{ class: "flex items-center justify-end gap-2" },
				Span({ class: "mr-auto text-[11px] text-muted-foreground" }, "⌘↵ to comment"),
				Button(
					{
						size: "sm",
						loading: posting,
						disabled: draft.bind((value) => value.trim() === ""),
						onClick: () => void post(),
					},
					"Comment",
				),
			),
		),
	);
}
