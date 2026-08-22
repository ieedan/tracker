import { router } from "$implement/router";
import {
	Article,
	Div,
	ForEach,
	H1,
	If,
	Implement,
	Span,
	signal,
	type Mountable,
	type Signal,
} from "@implementjs/core";
import { ArrowLeftIcon, TrashIcon } from "@implementjs/lucide";
import { api, ApiError } from "@/lib/api";
import { Editor } from "@/lib/components/editor";
import { UserAvatar } from "@/lib/components/issue-row";
import { InlineMarkdown, Markdown } from "@/lib/components/markdown";
import {
	AssigneeSelect,
	PrioritySelect,
	RepoSelect,
	StatusSelect,
} from "@/lib/components/property-select";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Separator } from "@/lib/components/ui/separator";
import { toast } from "@/lib/toast";
import type { CommentDto, IssueDto } from "@/lib/types";
import { WorkspaceContext } from "@/lib/workspace-context";
import { env } from "@/lib/env.public";
import type { PageProps } from "./$types";

/** One issue: its body, its properties, and its comments. */
export default function Page({ data }: PageProps) {
	return WorkspaceContext.Use((store) => {
		const issue: Signal<IssueDto> = signal(data.get().issue);
		const comments = signal<CommentDto[]>(data.get().comments);
		const editing = signal(false);
		const draftTitle = signal(issue.get().title);
		const draftBody = signal(issue.get().description);
		const newComment = signal("");
		const posting = signal(false);

		const slug = () => store.workspace.get().slug;

		/**
		 * Binds a property select to the issue.
		 *
		 * `issue.bind(...)` with a selector is read-only, so a select given one
		 * would look right and save nothing. Instead the select owns a local
		 * signal: what the user picks is pushed to the server, and what the
		 * server (or anyone else's edit) reports is pulled back in.
		 */
		const bridge = (
			read: (value: IssueDto) => string,
			write: (chosen: string) => Record<string, unknown>,
		) => {
			const local = signal<string | null>(read(issue.get()));

			const pull = Implement.Watch([issue], (current) => {
				const next = read(current);
				if (local.get() !== next) local.set(next);
			});

			const push = Implement.Lifecycle({
				onMount: () =>
					local.onChange((next) => {
						if (next === null || next === read(issue.get())) return;
						void patch(write(next));
					}),
			});

			return { local, pull, push };
		};

		const statusValue = bridge(
			(value) => value.status.id,
			(chosen) => ({ statusId: chosen }),
		);
		const priorityValue = bridge(
			(value) => String(value.priority),
			(chosen) => ({ priority: Number(chosen) }),
		);
		const repoValue = bridge(
			(value) => value.repo?.id ?? "none",
			(chosen) => ({ repoId: chosen === "none" ? null : chosen }),
		);
		const assigneeValue = bridge(
			(value) => value.assignee?.id ?? "none",
			(chosen) => ({ assigneeId: chosen === "none" ? null : chosen }),
		);

		const patch = async (body: Record<string, unknown>) => {
			try {
				issue.set(await api.issues.update(slug(), issue.get().identifier, body));
			} catch (thrown) {
				toast.add({
					title: "Could not save",
					description: thrown instanceof ApiError ? thrown.message : "Something went wrong",
					type: "error",
				});
			}
		};

		const saveEdits = async () => {
			await patch({ title: draftTitle.get().trim(), description: draftBody.get() });
			editing.set(false);
		};

		const postComment = async () => {
			const body = newComment.get().trim();
			if (body === "" || posting.get()) return;
			posting.set(true);
			try {
				await api.comments.create(slug(), issue.get().identifier, body);
				newComment.set("");
			} catch (thrown) {
				toast.add({
					title: "Could not post the comment",
					description: thrown instanceof ApiError ? thrown.message : "Something went wrong",
					type: "error",
				});
			} finally {
				posting.set(false);
			}
		};

		return Div(
			{ class: "flex min-h-0 flex-1" },

			// Navigating from one issue to another reuses this page.
			Implement.Watch([data], (next) => {
				issue.set(next.issue);
				comments.set(next.comments);
				editing.set(false);
				draftTitle.set(next.issue.title);
				draftBody.set(next.issue.description);
			}),

			// Live updates for this issue, including our own writes coming back around.
			Implement.Lifecycle({
				onMount: () =>
					store.on((event) => {
						if (event.type === "issue.updated" && event.issue.id === issue.get().id) {
							issue.set(event.issue);
						} else if (event.type === "comment.created" && event.issueId === issue.get().id) {
							if (!comments.get().some((c) => c.id === event.comment.id)) {
								comments.set([...comments.get(), event.comment]);
							}
						} else if (event.type === "comment.deleted" && event.issueId === issue.get().id) {
							comments.set(comments.get().filter((c) => c.id !== event.commentId));
						} else if (event.type === "issue.deleted" && event.issueId === issue.get().id) {
							router.navigate("/:workspace", { workspace: slug() });
						}
					}),
			}),

			Implement.Head(
				Implement.Head.Title(
					`${data.get().issue.identifier} ${data.get().plainTitle} · ${env.PUBLIC_APP_NAME}`,
				),
			),

			Div(
				{ class: "min-w-0 flex-1 overflow-y-auto" },
				Div(
					{ class: "mx-auto max-w-3xl px-6 py-6" },

					Div(
						{ class: "mb-4 flex items-center gap-2" },
						router.Link(
							{
								to: "/:workspace",
								params: { workspace: slug() },
								class:
									"inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground",
							},
							ArrowLeftIcon({ class: "size-4" }),
							"All issues",
						),
						Span({ class: "text-sm text-muted-foreground" }, "·"),
						Span({ class: "font-mono text-sm text-muted-foreground" }, issue.bind("identifier")),
					),

					If(editing)
						.Then(
							Div(
								{ class: "space-y-3" },
								Input({
									value: draftTitle,
									class: "text-lg font-semibold",
									placeholder: "Issue title",
								}),
								Editor({
									value: draftBody,
									workspace: store.workspace.get().slug,
									placeholder: "Describe the issue…",
									onSubmit: () => void saveEdits(),
								}),
								Div(
									{ class: "flex items-center gap-2" },
									Button({ onClick: () => void saveEdits() }, "Save"),
									Button(
										{
											variant: "ghost",
											onClick: () => {
												draftTitle.set(issue.get().title);
												draftBody.set(issue.get().description);
												editing.set(false);
											},
										},
										"Cancel",
									),
								),
							),
						)
						.Else(
							Div(
								{
									class: "group cursor-text space-y-3",
									onDblclick: () => editing.set(true),
									title: "Double-click to edit",
								},
								H1(
									{ class: "text-2xl font-semibold tracking-tight" },
									InlineMarkdown(issue.bind("titleHtml")),
								),
								If(issue.bind((value) => value.description.trim() !== ""))
									.Then(Markdown(issue.bind("descriptionHtml")))
									.Else(
										Span(
											{ class: "block text-sm text-muted-foreground" },
											"No description. Double-click to add one.",
										),
									),
								Button(
									{
										variant: "outline",
										size: "sm",
										class: "opacity-0 transition-opacity group-hover:opacity-100",
										onClick: () => editing.set(true),
									},
									"Edit",
								),
							),
						),

					Separator({ class: "my-8" }),

					Div(
						{ class: "space-y-5" },
						ForEach(
							comments,
							(comment) => comment.id,
							(comment) =>
								Article(
									{ class: "group flex gap-3" },
									Div({ class: "contents" }, UserAvatar(comment.get().author, "size-7 mt-0.5")),
									Div(
										{ class: "min-w-0 flex-1" },
										Div(
											{ class: "flex items-center gap-2" },
											Span(
												{ class: "text-sm font-medium" },
												comment.bind((value) => value.author?.name ?? "Someone"),
											),
											Span(
												{ class: "text-xs text-muted-foreground" },
												comment.bind((value) => new Date(value.createdAt).toLocaleString()),
											),
											If(
												comment.bind(
													(value) => value.author?.id === store.user.get()?.id,
												),
											).Then(
												Button(
													{
														variant: "ghost",
														size: "icon-xs",
														class: "ml-auto opacity-0 group-hover:opacity-100",
														"aria-label": "Delete comment",
														onClick: () =>
															void api.comments
																.remove(slug(), issue.get().identifier, comment.get().id)
																.catch(() =>
																	toast.add({
																		title: "Could not delete the comment",
																		type: "error",
																	}),
																),
													},
													TrashIcon({ class: "size-3" }),
												),
											),
										),
										Markdown(comment.bind("bodyHtml"), "mt-1"),
									),
								),
						),

						Div(
							{ class: "pt-2" },
							Editor({
								value: newComment,
								workspace: store.workspace.get().slug,
								placeholder: "Leave a comment…",
								onSubmit: () => void postComment(),
							}),
							Div(
								{ class: "mt-2 flex items-center gap-2" },
								Button(
									{ size: "sm", disabled: posting, onClick: () => void postComment() },
									"Comment",
								),
								Span(
									{ class: "text-xs text-muted-foreground" },
									"⌘↵ to post",
								),
							),
						),
					),
				),
			),

			Div(
				{ class: "hidden w-64 shrink-0 space-y-5 border-l px-4 py-6 lg:block" },

				statusValue.pull,
				statusValue.push,
				priorityValue.pull,
				priorityValue.push,
				repoValue.pull,
				repoValue.push,
				assigneeValue.pull,
				assigneeValue.push,

				Property(
					"Status",
					StatusSelect({ value: statusValue.local, statuses: store.statuses, class: "w-full" }),
				),
				Property("Priority", PrioritySelect({ value: priorityValue.local, class: "w-full" })),
				Property(
					"Assignee",
					AssigneeSelect({ value: assigneeValue.local, members: store.members, class: "w-full" }),
				),
				Property("Repo", RepoSelect({ value: repoValue.local, repos: store.repos, class: "w-full" })),

				Separator(),

				Div(
					{ class: "space-y-1 text-xs text-muted-foreground" },
					Div(
						{ class: "flex items-center gap-2" },
						"Created by",
						Span({ class: "text-foreground" }, issue.bind((value) => value.creator?.name ?? "—")),
					),
					Div(issue.bind((value) => `Opened ${new Date(value.createdAt).toLocaleDateString()}`)),
				),

				Button(
					{
						variant: "outline",
						size: "sm",
						class: "w-full text-destructive",
						onClick: async () => {
							if (!window.confirm(`Delete ${issue.get().identifier}? This cannot be undone.`)) return;
							await api.issues.remove(slug(), issue.get().identifier);
							router.navigate("/:workspace", { workspace: slug() });
						},
					},
					TrashIcon({ class: "size-3.5" }),
					"Delete issue",
				),
			),
		);

		function Property(label: string, control: Mountable) {
			return Div(
				{ class: "space-y-1.5" },
				Span({ class: "text-xs font-medium text-muted-foreground" }, label),
				control,
			);
		}
	});
}
