// The composer. Opened from anywhere — the sidebar button, `c`, the command
// palette — so its open state lives at module scope and the dialog itself is
// mounted once, in the app shell.
import {
	derived,
	Div,
	If,
	ImplementEffect,
	Input,
	Span,
	Textarea,
	signal,
} from "@implementjs/core";
import { X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "@/lib/components/ui/breadcrumb";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/lib/components/ui/dialog";
import { preferDefaultTeam, type IssuePriority, type IssueStatus } from "@/lib/domain/issues";
import type {
	Attachment,
	Issue,
	Label,
	Member,
	Repository,
	Team,
	TeamRef,
} from "@/lib/domain/schemas";
import { AttachmentGrid, removeAttachment } from "@/lib/features/attachments/attachment-list";
import {
	AttachTrigger,
	FileDragOverlay,
	beginUploads,
	preventFilePaste,
} from "@/lib/features/attachments/file-drop";
import type { Upload } from "@/lib/features/attachments/uploader";
import {
	clearIssueDraft,
	isBlankIssueDraft,
	loadIssueDraft,
	saveIssueDraft,
	type IssueDraft,
} from "./issue-draft";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker, TeamPicker } from "./pickers";
import { RepositoryPicker, type RepositoryRef } from "./repository-picker";
import { MentionMenu, fileMentions } from "./file-mentions";

const open = signal(false);
const slug = signal("");
/** Which team the composer opens on — the one you were looking at, if any. */
const preferredTeam = signal("");

/** Set when a create succeeds, so an open list can splice the issue in. */
export const issueCreated = signal<Issue | null>(null);

export function openCreateIssue(workspaceSlug: string, teamKey?: string): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	preferredTeam.set(teamKey ?? "");
	open.set(true);
}

export function CreateIssueDialog() {
	const title = signal("");
	const description = signal("");
	const status = signal<IssueStatus>("backlog");
	const priority = signal<IssuePriority>("none");
	const assignee = signal<Member["user"] | null>(null);
	const chosenLabels = signal<Label[]>([]);
	const attachments = signal<Attachment[]>([]);
	const uploads = signal<Upload[]>([]);
	const submitting = signal(false);

	// The pickers need the workspace's people and labels; they are fetched when
	// the composer opens rather than held by the shell, which does not have them.
	const members = signal<Member[]>([]);
	const labels = signal<Label[]>([]);
	const teams = signal<Team[]>([]);
	const chosenTeam = signal<TeamRef | null>(null);
	const repositories = signal<Repository[]>([]);
	const chosenRepository = signal<RepositoryRef | null>(null);
	const descriptionRef = signal<HTMLTextAreaElement | null>(null);
	const hasDraft = signal(false);

	// `@` in the description searches the linked repositories' file index.
	const mentions = fileMentions({
		value: description,
		slug: () => slug.get(),
		repository: () => chosenRepository.get()?.id,
		element: descriptionRef,
	});
	const titleInput = signal<HTMLInputElement | null>(null);
	let focusFrame: number | undefined;

	// Restore writes the same field signals the persist effect watches; this
	// flag keeps those writes from clobbering storage before they settle.
	let hydrating = false;
	let persistTimer: ReturnType<typeof setTimeout> | undefined;

	const snapshot = (): IssueDraft => ({
		title: title.get(),
		description: description.get(),
		status: status.get(),
		priority: priority.get(),
		assigneeId: assignee.get()?.id ?? null,
		labelIds: chosenLabels.get().map((label) => label.id),
		teamKey: chosenTeam.get()?.key ?? null,
		repositoryId: chosenRepository.get()?.id ?? null,
	});

	const persist = () => {
		if (hydrating || !open.get()) return;
		const workspaceSlug = slug.get();
		if (workspaceSlug === "") return;

		const draft = snapshot();
		if (isBlankIssueDraft(draft)) {
			clearIssueDraft(workspaceSlug);
			hasDraft.set(false);
			return;
		}

		saveIssueDraft(workspaceSlug, draft);
		hasDraft.set(true);
	};

	const schedulePersist = () => {
		if (persistTimer !== undefined) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = undefined;
			persist();
		}, 300);
	};

	const flushPersist = () => {
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		persist();
	};

	const reset = () => {
		title.set("");
		description.set("");
		status.set("backlog");
		priority.set("none");
		assignee.set(null);
		chosenLabels.set([]);
		chosenRepository.set(null);
		attachments.set([]);
		uploads.set([]);
	};

	const discard = () => {
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		hydrating = true;
		clearIssueDraft(slug.get());
		hasDraft.set(false);
		reset();
		const fallback = preferDefaultTeam(teams.get());
		chosenTeam.set(
			fallback === undefined ? null : { id: fallback.id, name: fallback.name, key: fallback.key },
		);
		hydrating = false;
	};

	const loadContext = async (workspaceSlug: string) => {
		hydrating = true;
		try {
			const draft = loadIssueDraft(workspaceSlug);
			hasDraft.set(draft !== null);

			if (draft === null) {
				reset();
			} else {
				title.set(draft.title);
				description.set(draft.description);
				status.set(draft.status);
				priority.set(draft.priority);
			}

			const [memberResult, labelResult, teamResult, repoResult] = await Promise.all([
				api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
			]);
			if (repoResult.error === undefined) {
				repositories.set(repoResult.data);
				if (draft !== null) {
					// A repository that has since been unlinked is dropped rather than
					// restored as a scope pointing at nothing.
					chosenRepository.set(
						repoResult.data
							.filter((repo) => repo.id === draft.repositoryId)
							.map((repo) => ({ id: repo.id, fullName: repo.fullName }))[0] ?? null,
					);
				}
			}
			if (memberResult.error === undefined) {
				members.set(memberResult.data);
				if (draft !== null) {
					assignee.set(
						draft.assigneeId === null
							? null
							: (memberResult.data.find((member) => member.user.id === draft.assigneeId)?.user ??
									null),
					);
				}
			}
			if (labelResult.error === undefined) {
				labels.set(labelResult.data);
				if (draft !== null) {
					const kept = new Set(draft.labelIds);
					chosenLabels.set(labelResult.data.filter((label) => kept.has(label.id)));
				}
			}

			if (teamResult.error !== undefined) return;
			teams.set(teamResult.data);

			// Draft team wins when it still exists; otherwise Engineering. With no
			// draft, open on the team you were looking at, then Engineering.
			let picked: Team | undefined;
			if (draft !== null) {
				picked =
					(draft.teamKey !== null
						? teamResult.data.find((team) => team.key === draft.teamKey)
						: undefined) ?? preferDefaultTeam(teamResult.data);
			} else {
				const wanted = preferredTeam.get();
				picked =
					(wanted !== "" ? teamResult.data.find((team) => team.key === wanted) : undefined) ??
					preferDefaultTeam(teamResult.data);
			}
			chosenTeam.set(
				picked === undefined ? null : { id: picked.id, name: picked.name, key: picked.key },
			);
		} finally {
			hydrating = false;
		}
	};

	const submit = async () => {
		const trimmed = title.get().trim();
		const team = chosenTeam.get();
		// A team is what gives the issue its identifier, so there is nothing to
		// create without one.
		if (trimmed === "" || team === null) return;

		submitting.set(true);
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/issues", {
			params: { slug: slug.get() },
			body: {
				teamKey: team.key,
				title: trimmed,
				description: description.get(),
				status: status.get(),
				priority: priority.get(),
				assigneeId: assignee.get()?.id ?? null,
				repositoryId: chosenRepository.get()?.id ?? null,
				labelIds: chosenLabels.get().map((label) => label.id),
				attachmentIds: attachments.get().map((attachment) => attachment.id),
			},
		});
		submitting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the issue"));
			return;
		}

		issueCreated.set(data);
		toastSuccess(`Created ${data.identifier}`);
		hydrating = true;
		clearIssueDraft(slug.get());
		hasDraft.set(false);
		reset();
		open.set(false);
		hydrating = false;
	};

	const attach = (files: File[]) => {
		beginUploads({
			files,
			slug: slug.get(),
			uploads,
			onUploaded: (attachment) => attachments.push(attachment),
		});
	};

	return Div(
		{ class: "contents" },
		FileDragOverlay({ enabled: open, onFiles: attach }),
		Dialog(
			{ open },
			ImplementEffect([open], (isOpen) => {
				if (focusFrame !== undefined) {
					cancelAnimationFrame(focusFrame);
					focusFrame = undefined;
				}
				if (isOpen) {
					void loadContext(slug.get());
					// The dialog focuses the first tabbable (the team crumb). Steal
					// it back once that pass has run so you can type a title.
					focusFrame = requestAnimationFrame(() => {
						focusFrame = undefined;
						titleInput.get()?.focus();
					});
					return;
				}
				flushPersist();
			}),
			ImplementEffect(
				[
					title,
					description,
					status,
					priority,
					assignee,
					chosenLabels,
					chosenTeam,
					chosenRepository,
				],
				() => schedulePersist(),
				{ immediate: false },
			),
			DialogContent(
				{ class: "max-w-xl gap-0 p-0", showCloseButton: false },
				Div(
					{ class: "flex items-center gap-2 border-b border-border px-3 py-2" },
					Breadcrumb(
						{ class: "min-w-0 flex-1" },
						BreadcrumbList(
							{ class: "items-center gap-1 leading-none sm:gap-1.5" },
							BreadcrumbItem(
								TeamPicker(
									chosenTeam,
									teams,
									(key) => {
										const picked = teams.get().find((team) => team.key === key);
										if (picked !== undefined) {
											chosenTeam.set({
												id: picked.id,
												name: picked.name,
												key: picked.key,
											});
										}
									},
									{ crumb: true },
								),
							),
							BreadcrumbSeparator(),
							BreadcrumbItem(
								DialogTitle(
									{ class: "text-[13px] leading-none font-medium text-foreground" },
									"New issue",
								),
							),
						),
					),
					DialogClose(
						{
							variant: "ghost",
							size: "icon-sm",
							class: "size-7 shrink-0",
						},
						X({ class: "size-4", "aria-hidden": true }),
						Span({ class: "sr-only" }, "Close"),
					),
				),

				Div(
					{
						class: "flex flex-col gap-2 px-4 py-3",
						onPaste: (event) => preventFilePaste(event, attach),
					},
					Input({
						this: titleInput,
						value: title,
						placeholder: "Issue title",
						class:
							"h-8 border-0 bg-transparent p-0 text-[15px] font-medium outline-none placeholder:text-muted-foreground",
						autofocus: true,
						onKeydown: (event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
						},
					}),
					Div(
						{ class: "relative" },
						Textarea({
							this: descriptionRef,
							value: description,
							placeholder: "Add description… @ to reference a file",
							rows: 4,
							class:
								"w-full resize-none border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted-foreground",
							onInput: mentions.onInput,
							onKeydown: (event) => {
								// The mention menu claims the arrows, Enter and Escape while
								// it is open, so it gets the event first.
								mentions.onKeydown(event);
								if (event.defaultPrevented) return;
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
							},
						}),
						MentionMenu(mentions),
					),
					AttachmentGrid({
						attachments,
						uploads,
						slug,
						onRemove: (attachment) => void removeAttachment(slug.get(), attachment, attachments),
					}),
				),

				Div(
					{ class: "flex flex-wrap items-center gap-1.5 px-4 pb-3" },
					AttachTrigger({ onFiles: attach }),
					StatusPicker(status, (value) => status.set(value), {
						showLabel: true,
						class: "border border-border",
					}),
					PriorityPicker(priority, (value) => priority.set(value), {
						showLabel: true,
						class: "border border-border",
					}),
					AssigneePicker(
						assignee,
						members,
						(userId) =>
							assignee.set(
								userId === null
									? null
									: (members.get().find((member) => member.user.id === userId)?.user ?? null),
							),
						{ showLabel: true, class: "border border-border" },
					),
					RepositoryPicker(
						chosenRepository,
						repositories,
						(repositoryId) =>
							chosenRepository.set(
								repositoryId === null
									? null
									: (repositories
											.get()
											.filter((repo) => repo.id === repositoryId)
											.map((repo) => ({ id: repo.id, fullName: repo.fullName }))[0] ?? null),
							),
						{ class: "border border-border" },
					),
					LabelPicker(
						chosenLabels,
						labels,
						(labelId) =>
							chosenLabels.update((current) =>
								current.some((label) => label.id === labelId)
									? current.filter((label) => label.id !== labelId)
									: [...current, labels.get().find((label) => label.id === labelId)!],
							),
						{ class: "border border-border" },
					),
				),

				DialogDescription({ class: "sr-only" }, "Create a new issue in this workspace."),

				Div(
					{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
					If(
						hasDraft,
						Div(
							{ class: "mr-auto flex items-baseline gap-1.5" },
							Span({ class: "text-[11px] leading-none text-muted-foreground" }, "Draft saved"),
							Button(
								{
									variant: "ghost",
									size: "sm",
									class:
										"h-auto min-h-0 px-0 py-0 text-[11px] leading-none font-normal text-muted-foreground hover:bg-transparent hover:text-foreground",
									onClick: discard,
								},
								"Discard",
							),
						),
					),
					Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
					Button(
						{
							size: "sm",
							loading: submitting,
							disabled: derived(
								[title, chosenTeam],
								(value, team) => value.trim() === "" || team === null,
							),
							onClick: () => void submit(),
						},
						"Create",
						Span({ class: "text-[11px] font-normal opacity-70" }, "⌘⏎"),
					),
				),
			),
		),
	);
}
