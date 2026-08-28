import { router } from "$implement/router";
import {
	Div,
	Dynamic,
	Fragment,
	H1,
	If,
	ImplementDocument,
	ImplementEffect,
	Input,
	P,
	Span,
	derived,
	mediaQuery,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import { Bell, BellOff, ChevronLeft } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import type {
	Activity,
	Attachment,
	Comment,
	Issue,
	Label,
	Member,
	Repository,
	Team,
	Workspace,
} from "@/lib/domain/schemas";
import { AttachmentGrid, removeAttachment } from "@/lib/features/attachments/attachment-list";
import {
	AttachTrigger,
	FileDragOverlay,
	beginUploads,
	preventFilePaste,
} from "@/lib/features/attachments/file-drop";
import type { Upload } from "@/lib/features/attachments/uploader";
import { fullTime } from "@/lib/format";
import { CopyPromptButton } from "./copy-prompt";
import { createIssueOpen, openCreateIssue } from "./create-issue-dialog";
import { isTyping } from "@/lib/client/is-typing";
import { AssigneePicker, PriorityPicker, StatusPicker, TeamPicker } from "./pickers";
import { IssueLabelPicker } from "./label-picker";
import { IssueTimeline, type CommentActions } from "./activity-feed";
import { patchIssue } from "./issue-store";
import { RepositoryPicker } from "./repository-picker";
import { PullRequestLink } from "./pull-request-link";
import { BodyComposer } from "./body-composer";
import { TransferIssueButton } from "./transfer-issue";
import { DeleteIssueButton } from "./delete-issue";
import { KEY_HINT_CLASS } from "@/lib/components/ui/kbd";
import { cn } from "@/lib/utils";

interface PageData {
	issue: Issue;
	repositories: Repository[];
	attachments: Attachment[];
	comments: Comment[];
	activity: Activity[];
	workspace: Workspace;
	teams: Team[];
	members: Member[];
	labels: Label[];
	/** Whether the viewer is following this issue — the rail's Subscribe state. */
	subscribed: boolean;
	/** From the app layout — whose comments get an Edit and a Delete. */
	user: { id: string };
}

export interface IssueDetailPageOptions {
	/**
	 * Rendered inside another screen — the inbox's reading pane — rather than as
	 * the whole of /issue/:identifier.
	 *
	 * Two differences, both about the host: the breadcrumb header is dropped,
	 * because the host has one of its own above this, and the rail waits for a
	 * wider viewport, because the host is holding a list beside it and 1024px of
	 * window is nowhere near 1024px of pane.
	 */
	embedded?: boolean;
}

export function IssueDetailPage({
	data,
	params,
	embedded = false,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string>; identifier: Readable<string> };
} & IssueDetailPageOptions) {
	// `patchIssue` works over a list, so the detail page keeps a list of one.
	const issues = signal<Issue[]>([data.get().issue]);
	data.onChange((next) => issues.set([next.issue]));
	const issue = issues.bind((list) => list[0]!);

	const comments = signal(data.get().comments);
	data.onChange((next) => comments.set(next.comments));

	// Edit and delete return whether they landed, so the row knows to keep its
	// editor or confirmation up when the server refused.
	const commentActions: CommentActions = {
		viewerId: data.bind((value) => value.user.id),
		isAdmin: data.bind((value) => value.workspace.role === "admin"),
		onEdit: async (id, body) => {
			const { data: updated, error } = await api.PATCH(
				"/api/v1/workspaces/[slug]/issues/[identifier]/comments/[commentId]",
				{
					params: { slug: params.slug.get(), identifier: issue.get().identifier, commentId: id },
					body: { body },
				},
			);
			if (error !== undefined) {
				toastError(messageOf(error, "Could not update the comment"));
				return false;
			}
			comments.set(comments.get().map((entry) => (entry.id === id ? updated : entry)));
			return true;
		},
		onDelete: async (id) => {
			const { error } = await api.DELETE(
				"/api/v1/workspaces/[slug]/issues/[identifier]/comments/[commentId]",
				{ params: { slug: params.slug.get(), identifier: issue.get().identifier, commentId: id } },
			);
			if (error !== undefined) {
				toastError(messageOf(error, "Could not delete the comment"));
				return false;
			}
			comments.set(comments.get().filter((entry) => entry.id !== id));
			return true;
		},
	};

	const activity = signal(data.get().activity);
	data.onChange((next) => activity.set(next.activity));

	// Kit cannot re-run a load after a mutation, and every edit made from the
	// rail is something the timeline is supposed to have just recorded — so the
	// entries are refetched rather than guessed at locally.
	const refreshActivity = async () => {
		const { data: entries, error } = await api.GET(
			"/api/v1/workspaces/[slug]/issues/[identifier]/activity",
			{ params: { slug: params.slug.get(), identifier: issue.get().identifier } },
		);
		if (error === undefined) activity.set(entries);
	};

	const attachments = signal(data.get().attachments);
	data.onChange((next) => attachments.set(next.attachments));
	const uploads = signal<Upload[]>([]);

	const attachToIssue = (files: File[]) => {
		beginUploads({
			files,
			slug: params.slug.get(),
			issueId: issue.get().id,
			uploads,
			onUploaded: (attachment) => attachments.push(attachment),
		});
	};

	const repositories = data.bind((value) => value.repositories);
	const linkedPull = signal(data.get().issue.pullRequest);
	data.onChange((next) => linkedPull.set(next.issue.pullRequest));

	const teamOpen = signal(false);
	const statusOpen = signal(false);
	const priorityOpen = signal(false);
	const assigneeOpen = signal(false);
	const labelOpen = signal(false);

	const openMenu = (which: "team" | "status" | "priority" | "assignee" | "label") => {
		teamOpen.set(which === "team");
		statusOpen.set(which === "status");
		priorityOpen.set(which === "priority");
		assigneeOpen.set(which === "assignee");
		labelOpen.set(which === "label");
	};

	const update = (patch: Parameters<typeof patchIssue>[4], apply: (value: Issue) => Issue) =>
		void patchIssue(
			issues,
			params.slug.get(),
			data.get().issue.id,
			data.get().issue.identifier,
			patch,
			apply,
		).then((updated) => {
			if (updated !== undefined) void refreshActivity();
		});

	// Wide enough for the properties rail; below this the same sections stack
	// under the body instead, because a fixed 16rem column would eat the page.
	// Embedded, the notification list has already taken 380px off the front.
	const hasRail = mediaQuery(embedded ? "(min-width: 1400px)" : "(min-width: 1024px)");

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

	// Linear puts the properties in a right rail rather than above the body,
	// under headings rather than beside per-row labels. Every pill already
	// says what it is — a status ring, a priority column, an avatar, a
	// coloured dot — so a "Status" caption next to a control reading
	// "In Progress" is a word doing no work.
	//
	// A factory rather than a node: the sections mount in the rail on a wide
	// viewport and inline under the body on a narrow one, and only one of the
	// two exists at a time — which is also what keeps the pickers' shared
	// `open` signals pointing at a single mounted menu.
	const propertySections = (): Child[] => [
		PropertySection(
			"Properties",
			StatusPicker(
				issue.bind("status"),
				(status) => update({ status }, (value) => ({ ...value, status })),
				{ showLabel: true, open: statusOpen, class: propertyClass },
			),
			PriorityPicker(
				issue.bind("priority"),
				(priority) => update({ priority }, (value) => ({ ...value, priority })),
				{ showLabel: true, open: priorityOpen, class: propertyClass },
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
				{ showLabel: true, open: assigneeOpen, class: propertyClass },
			),
			TeamPicker(
				issue.bind("team"),
				data.bind((value) => value.teams),
				moveTeam,
				{ showLabel: true, open: teamOpen, class: propertyClass },
			),
			RepositoryPicker(
				issue.bind((value) => value.repository),
				repositories,
				(repositoryId) =>
					update({ repositoryId }, (value) => ({
						...value,
						repository:
							repositoryId === null
								? null
								: (data
										.get()
										.repositories.filter((repo) => repo.id === repositoryId)
										.map((repo) => ({
											id: repo.id,
											fullName: repo.fullName,
											provider: repo.provider,
										}))[0] ?? value.repository),
					})),
				{ showLabel: true, class: propertyClass },
			),
			Div(
				{ class: "px-1" },
				PullRequestLink({
					slug: params.slug,
					identifier: issue.bind("identifier"),
					current: linkedPull,
					enabled: repositories.bind((list) => list.length > 0),
				}),
			),
		),

		// Labels get their own section rather than a row, because there are any
		// number of them and each one is its own control.
		PropertySection(
			"Labels",
			IssueLabelPicker({
				selected: issue.bind("labels"),
				available: data.bind((value) => value.labels),
				onToggle: (labelId) =>
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
				open: labelOpen,
			}),
		),

		Div(
			{ class: "flex flex-col items-start gap-1 border-t border-border pt-3" },
			SubscribeButton({
				slug: params.slug,
				identifier: issue.bind("identifier"),
				subscribed: data.bind((value) => value.subscribed),
			}),
			CopyPromptButton({ issue, slug: params.slug }),
			TransferIssueButton({ slug: params.slug, issue }),
			DeleteIssueButton({ slug: params.slug, issue }),
		),

		Div(
			{ class: "text-[11px] text-muted-foreground" },
			P(
				{},
				issue.bind((value) => `Created ${fullTime(value.createdAt)}`),
			),
			P(
				{},
				issue.bind((value) => `by ${value.creator.name}`),
			),
		),
	];

	return Div(
		{ class: "flex min-h-0 flex-1" },

		FileDragOverlay({
			enabled: derived([createIssueOpen], (dialogOpen) => !dialogOpen),
			onFiles: attachToIssue,
		}),

		ImplementDocument({
			onKeydown: (event) => {
				if (isTyping(event)) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				const key = event.key.toLowerCase();
				if (key === "c") {
					event.preventDefault();
					openCreateIssue(params.slug.get());
					return;
				}
				if (key === "t") {
					event.preventDefault();
					openMenu("team");
				} else if (key === "s") {
					event.preventDefault();
					openMenu("status");
				} else if (key === "p") {
					event.preventDefault();
					openMenu("priority");
				} else if (key === "a") {
					event.preventDefault();
					openMenu("assignee");
				} else if (key === "l") {
					event.preventDefault();
					openMenu("label");
				}
			},
		}),

		Div(
			{ class: "flex min-w-0 flex-1 flex-col" },
			embedded
				? null
				: Div(
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
						Span(
							{ class: "font-mono text-[12px] text-muted-foreground" },
							issue.bind("identifier"),
						),
					),

			Div(
				{ class: "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-8 sm:py-6" },
				Div(
					{ class: "mx-auto flex max-w-3xl flex-col gap-6" },
					EditableTitle(issue, update),
					Div(
						{
							class: "flex flex-col gap-2",
							onPaste: (event) => preventFilePaste(event, attachToIssue),
						},
						EditableDescription(issue, update, params),
						AttachmentGrid({
							attachments,
							uploads,
							slug: params.slug,
							onRemove: (attachment) =>
								void removeAttachment(params.slug.get(), attachment, attachments),
						}),
						AttachTrigger({ onFiles: attachToIssue }),
					),

					// No room for the rail: the same sections, boxed, under the body.
					If(
						hasRail.bind((wide) => !wide),
						Div(
							{ class: "flex flex-col gap-5 rounded-md border border-border p-4" },
							...propertySections(),
						),
					),

					CommentThread(
						comments,
						activity,
						issue,
						params,
						issue.bind((value) => value.repository?.id),
						commentActions,
					),
				),
			),
		),

		// The rail, when the viewport can afford one.
		If(
			hasRail,
			Div(
				{ class: "flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-4" },
				...propertySections(),
			),
		),
	);
}

function toggle(ids: string[], id: string): string[] {
	return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

/**
 * Follow, or stop following, this issue — Linear's Subscribe, in the rail with
 * the other per-issue actions.
 *
 * Most subscriptions arrive without anyone pressing anything: commenting on an
 * issue subscribes you, and so does having one assigned to you. This is for the
 * two cases those miss — something you want to watch without touching, and
 * something you have stopped caring about. What you follow is what the
 * Subscribed tab of My Issues lists.
 *
 * The state is seeded by the page load rather than fetched here, so the button
 * renders correct on the server instead of settling a moment later. The write
 * is optimistic and rolls back, like every other control on this page.
 */
function SubscribeButton({
	slug,
	identifier,
	subscribed,
}: {
	slug: Readable<string>;
	identifier: Readable<string>;
	subscribed: Readable<boolean>;
}) {
	const on = signal(subscribed.get());
	const pending = signal(false);

	const write = async () => {
		const next = !on.get();
		on.set(next);
		pending.set(true);

		const { error } = await api.POST("/api/v1/workspaces/[slug]/issues/[identifier]/subscribe", {
			params: { slug: slug.get(), identifier: identifier.get() },
			body: { subscribed: next },
		});
		pending.set(false);

		if (error !== undefined) {
			on.set(!next);
			toastError(messageOf(error, next ? "Could not subscribe" : "Could not unsubscribe"));
		}
	};

	return Fragment(
		// Navigating between issues reseeds the load rather than remounting the
		// rail, so the button has to follow `data` — but never on top of a write
		// still in flight, whose optimistic value is the newer of the two.
		ImplementEffect([subscribed], (value) => {
			if (!pending.get()) on.set(value);
		}),

		Button(
			{
				size: "sm",
				variant: "ghost",
				class: "h-7 w-full justify-start gap-1.5 px-1.5 text-[12px] text-muted-foreground",
				title: on.bind((value) =>
					value ? "Stop getting notified about this issue" : "Get notified about this issue",
				),
				onClick: () => void write(),
			},
			Dynamic([on], (value) =>
				value ? Bell({ class: "size-3.5 text-primary" }) : BellOff({ class: "size-3.5" }),
			),
			on.bind((value) => (value ? "Subscribed" : "Subscribe")),
		),
	);
}

/**
 * A rail pill: full width, value first, no caption.
 *
 * The pickers default to an inline chip sized for a list row; in the rail they
 * are rows of their own, which is what makes the section read as a list of
 * properties rather than a scatter of buttons.
 */
const propertyClass = "flex h-7 w-full justify-start gap-2 px-2 text-[13px] text-foreground";

/** A titled group of properties — Linear's "Properties" and "Labels" blocks. */
function PropertySection(title: string, ...children: Child[]) {
	return Div(
		{ class: "flex flex-col gap-1.5" },
		Span(
			{ class: "px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase" },
			title,
		),
		Div({ class: "flex flex-col gap-0.5" }, ...children),
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

/** The same words in the box and in its place, so the two cannot drift apart. */
const DESCRIPTION_PLACEHOLDER = "Add description… @ to mention someone or a file";

/**
 * The issue body, which is always the editor.
 *
 * It used to be two views — the body rendered until you clicked it, and a
 * textarea from then on — because the overlay the composer drew its mentions
 * with had to sit on raw characters, and a rendered `**bold**` is four
 * characters shorter than the text underneath it. Nothing lines up across that
 * gap, so the two could not be the same element.
 *
 * The composer renders now, so they are. Two views cost exactly what a swap
 * always costs: the click that opened the editor was spent on the thing it
 * replaced, so the caret landed at the end of the body rather than where you
 * pressed, and the body moved as one element gave way to another with its own
 * height. One element has neither problem — click into it anywhere, and the
 * caret is where you clicked because nothing was exchanged.
 */
function EditableDescription(
	issue: Readable<Issue>,
	update: (patch: { description: string }, apply: (value: Issue) => Issue) => void,
	params: { slug: Readable<string> },
) {
	// Seeded rather than filled by the effect below, so the body the server
	// rendered is in the box the first time it is drawn.
	const draft = signal(issue.get().description);
	const draftRef = signal<HTMLElement | null>(null);

	const commit = () => {
		const next = draft.get();
		if (next === issue.get().description) return;
		update({ description: next }, (value) => ({ ...value, description: next }));
	};

	return Fragment(
		// The stored body fills the box on load, and again when it changes
		// somewhere else — but never on top of what is being typed here.
		ImplementEffect([issue], (value) => {
			// Null before the box is mounted, and on the server, where there is no
			// `document` to ask.
			const node = draftRef.get();
			if (node !== null && node === document.activeElement) return;
			draft.set(value.description);
		}),

		// The same box as the create dialog, so an issue body is written the same
		// way whichever screen it is being written on.
		BodyComposer({
			value: draft,
			element: draftRef,
			slug: () => params.slug.get(),
			repository: () => issue.get().repository?.id,
			placeholder: DESCRIPTION_PLACEHOLDER,
			// The body is as tall as it needs to be here: there is no dialog to stay
			// inside, and a scrollbar within a page that already scrolls is the worst
			// of both. No `rows` either — the box stands in for the rendered body
			// now, and reserving four lines under a one-line description would leave
			// a hole where the page used to close up.
			autoGrow: true,
			onBlur: commit,
			// Blur commits, so ⌘⏎ only has to leave the box.
			onSubmit: () => draftRef.get()?.blur(),
			onEscape: () => {
				draft.set(issue.get().description);
				draftRef.get()?.blur();
			},
		}),
	);
}

/**
 * The activity view: everything that has happened to the issue, oldest first,
 * with the comment box at the bottom. Comments are only one kind of entry now,
 * so the heading says Activity and the timeline decides how each one reads.
 */
function CommentThread(
	comments: ReturnType<typeof signal<Comment[]>>,
	activity: Readable<Activity[]>,
	issue: Readable<Issue>,
	params: { slug: Readable<string>; identifier: Readable<string> },
	repositoryId: Readable<string | undefined>,
	actions: CommentActions,
) {
	const draft = signal("");
	const posting = signal(false);
	const draftRef = signal<HTMLElement | null>(null);
	const draftAttachments = signal<Attachment[]>([]);
	const draftUploads = signal<Upload[]>([]);

	const attach = (files: File[]) => {
		beginUploads({
			files,
			slug: params.slug.get(),
			uploads: draftUploads,
			onUploaded: (attachment) => draftAttachments.push(attachment),
		});
	};

	const post = async () => {
		const body = draft.get().trim();
		if (body === "") return;

		posting.set(true);
		const { data, error } = await api.POST(
			"/api/v1/workspaces/[slug]/issues/[identifier]/comments",
			{
				params: { slug: params.slug.get(), identifier: params.identifier.get() },
				body: {
					body,
					attachmentIds: draftAttachments.get().map((attachment) => attachment.id),
				},
			},
		);
		posting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not post the comment"));
			return;
		}
		comments.push(data);
		draft.set("");
		draftAttachments.set([]);
		draftUploads.set([]);
	};

	return Div(
		{ class: "flex flex-col gap-4 border-t border-border pt-6" },
		Span({ class: "text-[13px] font-medium" }, "Activity"),

		Div(
			{ class: "flex flex-col gap-4" },
			IssueTimeline({ comments, activity, issue, slug: params.slug, actions }),
		),

		Div(
			{
				class: "relative flex flex-col gap-2 rounded-md border border-border p-3",
				onPaste: (event) => preventFilePaste(event, attach),
			},
			// The same box as the description and the create dialog — the same `@`
			// wiring, the same keys, the same markdown as it is written — so a
			// comment is written the way every other body on the page is.
			BodyComposer({
				value: draft,
				element: draftRef,
				slug: () => params.slug.get(),
				repository: () => repositoryId.get(),
				placeholder: "Leave a comment… @ to mention someone or a file",
				rows: 3,
				autoGrow: true,
				onSubmit: () => void post(),
			}),
			AttachmentGrid({
				attachments: draftAttachments,
				uploads: draftUploads,
				slug: params.slug,
				onRemove: (attachment) =>
					void removeAttachment(params.slug.get(), attachment, draftAttachments),
			}),
			Div(
				{ class: "flex items-center gap-2" },
				AttachTrigger({ onFiles: attach }),
				Button(
					{
						size: "sm",
						class: "ml-auto",
						loading: posting,
						disabled: draft.bind((value) => value.trim() === ""),
						onClick: () => void post(),
					},
					"Comment",
					Span({ class: cn("text-[11px] font-normal opacity-70", KEY_HINT_CLASS) }, "⌘⏎"),
				),
			),
		),
	);
}
