/**
 * The reply thread, shared by the workspace tab and the public board.
 *
 * They are genuinely the same conversation, so they are the same component:
 * what differs is `canPost` (signed in or not) and `canNote` (a member, who may
 * leave an internal note). Building two would guarantee they drifted.
 */
import { Div, ForEach, If, Span, Textarea, signal, type Readable } from "@implementjs/core";
import { Lock, MessageSquare } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { UserAvatar } from "@/lib/components/glyphs";
import { Markdown } from "@/lib/components/markdown";
import { Button } from "@/lib/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import type { FeedbackComment } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";

export function FeedbackThread(options: {
	comments: ReturnType<typeof signal<FeedbackComment[]>>;
	slug: Readable<string>;
	feedbackId: Readable<string>;
	/** False for a signed-out visitor: they read, they do not write. */
	canPost: Readable<boolean>;
	/** Members only — the internal-note toggle is hidden for everyone else. */
	canNote?: Readable<boolean>;
	/** Shown in place of the composer when `canPost` is false. */
	signInPrompt?: string;
}) {
	const draft = signal("");
	const posting = signal(false);
	const internal = signal(false);

	const post = async () => {
		const body = draft.get().trim();
		if (body === "") return;

		posting.set(true);
		const { data, error } = await api.POST(
			"/api/v1/workspaces/[slug]/user-feedback/[id]/comments",
			{
				params: { slug: options.slug.get(), id: options.feedbackId.get() },
				body: { body, internal: internal.get() },
			},
		);
		posting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not post the reply"));
			return;
		}
		options.comments.push(data);
		draft.set("");
		internal.set(false);
	};

	return Div(
		{ class: "flex flex-col gap-4 border-t border-border pt-6" },
		Span({ class: "text-[13px] font-medium" }, "Replies"),

		If(
			options.comments.bind((list) => list.length === 0),
			Empty(
				{ class: "border p-4 md:p-6" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, MessageSquare({ "aria-hidden": true })),
					EmptyTitle("No replies yet"),
					EmptyDescription("Be the first to reply."),
				),
			),
		),

		ForEach(
			options.comments,
			(comment) => comment.id,
			(comment) =>
				Div(
					{
						// An internal note reads as a different kind of thing, because it
						// is: nobody outside the workspace will ever see it.
						class: comment.get().internal
							? "flex gap-3 rounded-md border border-dashed border-border bg-secondary/30 p-2"
							: "flex gap-3",
					},
					UserAvatar(comment.get().author, "mt-0.5"),
					Div(
						{ class: "min-w-0 flex-1" },
						Div(
							{ class: "flex items-baseline gap-2" },
							Span(
								{ class: "text-[13px] font-medium" },
								comment.bind((value) => value.author.name),
							),
							Span(
								{ class: "text-[11px] text-muted-foreground" },
								comment.bind((value) => relativeTime(value.createdAt)),
							),
							comment.get().internal
								? Span(
										{
											class:
												"inline-flex items-center gap-1 rounded bg-secondary px-1.5 text-[10px] text-muted-foreground",
										},
										Lock({ class: "size-2.5" }),
										"Internal",
									)
								: null,
						),
						// The same renderer the issue timeline uses — a reply is a
						// comment, and the two threads should not disagree about what
						// `**bold**` means.
						Markdown(comment.bind("body"), { class: "mt-0.5" }),
					),
				),
		),

		If(options.canPost)
			.Then(
				Div(
					{ class: "flex flex-col gap-2 rounded-md border border-border p-3" },
					Textarea({
						value: draft,
						rows: 3,
						placeholder: "Write a reply…",
						class:
							"resize-none border-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground",
						onKeydown: (event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void post();
						},
					}),
					Div(
						{ class: "flex items-center gap-2" },
						options.canNote === undefined
							? null
							: If(
									options.canNote,
									Button(
										{
											size: "sm",
											variant: "ghost",
											class: internal.bind((on) =>
												on
													? "h-6 gap-1 bg-secondary px-2 text-[11px]"
													: "h-6 gap-1 px-2 text-[11px] text-muted-foreground",
											),
											title: "Internal notes stay inside the workspace",
											onClick: () => internal.update((value) => !value),
										},
										Lock({ class: "size-3" }),
										internal.bind((on) => (on ? "Internal note" : "Reply publicly")),
									),
								),
						Span(
							{ class: "ml-auto text-[11px] text-muted-foreground" },
							"Markdown supported · ⌘↵ to send",
						),
						Button(
							{
								size: "sm",
								loading: posting,
								disabled: draft.bind((value) => value.trim() === ""),
								onClick: () => void post(),
							},
							"Reply",
						),
					),
				),
			)
			.Else(
				Div(
					{
						class:
							"rounded-md border border-dashed border-border p-3 text-[12px] text-muted-foreground",
					},
					options.signInPrompt ?? "Sign in to reply.",
				),
			),
	);
}
