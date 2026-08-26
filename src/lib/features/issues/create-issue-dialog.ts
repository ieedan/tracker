// The composer. Opened from anywhere — the sidebar button, `c`, the command
// palette — so its open state lives at module scope and the dialog itself is
// mounted once, in the app shell.
import {
	derived,
	Div,
	If,
	ImplementDocument,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	Span,
	signal,
} from "@implementjs/core";
import { X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { isTyping } from "@/lib/client/is-typing";
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
// Aliased: `Label` is already the issue label type in this module.
import { Label as ControlLabel } from "@/lib/components/ui/label";
import { Switch } from "@/lib/components/ui/switch";
import { preferDefaultTeam, type IssuePriority, type IssueStatus } from "@/lib/domain/issues";
import type {
	Attachment,
	Issue,
	IssueTemplate,
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
	loadCreateMore,
	loadIssueDraft,
	saveCreateMore,
	saveIssueDraft,
	type IssueDraft,
} from "./issue-draft";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker, TeamPicker } from "./pickers";
import { RepositoryPicker, toRepositoryRef, type RepositoryRef } from "./repository-picker";
import { BodyComposer } from "./body-composer";

const open = signal(false);
/** So the issue page can yield the drop overlay while this dialog is up. */
export { open as createIssueOpen };
const slug = signal("");
/** Which team the composer opens on — the one you were looking at, if any. */
const preferredTeam = signal("");

/**
 * The template the next open should apply, consumed once by `loadContext`.
 *
 * A signal rather than a parameter because the dialog is mounted once in the
 * shell — the same reason `slug` and `preferredTeam` live out here.
 */
const pendingTemplate = signal<IssueTemplate | null>(null);

/** Set when a create succeeds, so an open list can splice the issue in. */
export const issueCreated = signal<Issue | null>(null);

/**
 * The team a given open lands on: the one asked for when it still exists,
 * otherwise Engineering. `wanted` is empty when nothing pins a team — a plain
 * open passes the team you were looking at.
 *
 * Every path that has to answer "which team?" — open, restore, discard, create
 * more — goes through here so they cannot drift apart.
 */
function teamRefFor(available: Team[], wanted: string): TeamRef | null {
	const picked =
		(wanted !== "" ? available.find((team) => team.key === wanted) : undefined) ??
		preferDefaultTeam(available);
	return picked === undefined ? null : { id: picked.id, name: picked.name, key: picked.key };
}

/**
 * The repository a composer scopes to when nothing else names one: the
 * workspace's only linked repository, or null when there are none or several.
 * Set on the pill rather than at create time, so it is visible and clearable.
 */
function soleRepositoryRef(available: Repository[]): RepositoryRef | null {
	return available.length === 1 ? toRepositoryRef(available[0]!) : null;
}

export function openCreateIssue(workspaceSlug: string, teamKey?: string): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	preferredTeam.set(teamKey ?? "");
	// A plain New issue is never a leftover template from a previous open.
	pendingTemplate.set(null);
	open.set(true);
}

/**
 * Opens the composer on a workspace template.
 *
 * A template is an explicit "start from this", so it wins over the saved draft
 * rather than merging with it — the draft is only overwritten once the fields
 * change, exactly as if it had been typed.
 */
export function openCreateIssueFromTemplate(
	workspaceSlug: string,
	template: IssueTemplate,
	teamKey?: string,
): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	preferredTeam.set(teamKey ?? "");
	pendingTemplate.set(template);
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
	// "Create more": keep the composer up after a create so issues can be filed
	// back to back. Remembered across opens, and across reloads.
	const createMore = signal(false);

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
	const statusOpen = signal(false);
	const priorityOpen = signal(false);
	const assigneeOpen = signal(false);
	const repositoryOpen = signal(false);
	const labelOpen = signal(false);

	const openMenu = (which: "status" | "priority" | "assignee" | "repository" | "label") => {
		statusOpen.set(which === "status");
		priorityOpen.set(which === "priority");
		assigneeOpen.set(which === "assignee");
		repositoryOpen.set(which === "repository");
		labelOpen.set(which === "label");
	};

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
		attachments: attachments.get(),
	});

	const persist = () => {
		// Open is not required: a close flushes after `open` is already false,
		// and an upload can finish after the dialog is dismissed.
		if (hydrating) return;
		const workspaceSlug = slug.get();
		if (workspaceSlug === "") return;

		const draft = snapshot();
		if (isBlankIssueDraft(draft, soleRepositoryRef(repositories.get())?.id ?? null)) {
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

	const focusTitle = () => {
		if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
		focusFrame = requestAnimationFrame(() => {
			focusFrame = undefined;
			titleInput.get()?.focus();
		});
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

	/**
	 * Back to exactly what a freshly opened composer shows: every field at its
	 * default, and the team resolved the way an open resolves it — the one you
	 * are currently viewing, else Engineering.
	 *
	 * Used by both "create more" and Discard, so neither invents its own idea
	 * of what empty means.
	 */
	const resetToDefaults = () => {
		reset();
		chosenTeam.set(teamRefFor(teams.get(), preferredTeam.get()));
		chosenRepository.set(soleRepositoryRef(repositories.get()));
	};

	const discard = () => {
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		const leftover = attachments.get();
		const workspaceSlug = slug.get();
		hydrating = true;
		clearIssueDraft(workspaceSlug);
		hasDraft.set(false);
		resetToDefaults();
		hydrating = false;
		for (const file of leftover) {
			void api.DELETE("/api/v1/workspaces/[slug]/attachments/[id]", {
				params: { slug: workspaceSlug, id: file.id },
			});
		}
	};

	const loadContext = async (workspaceSlug: string) => {
		hydrating = true;
		try {
			// Read on open rather than at module load: there is no storage during
			// SSR, and another tab may have flipped it since.
			createMore.set(loadCreateMore());

			// Consumed here so a later open — the sidebar button, `c` — is a plain
			// composer again rather than the last template picked.
			const template = pendingTemplate.get();
			pendingTemplate.set(null);

			const draft = template === null ? loadIssueDraft(workspaceSlug) : null;
			hasDraft.set(draft !== null);

			if (template !== null) {
				reset();
				title.set(template.title);
				description.set(template.description);
				status.set(template.status);
				priority.set(template.priority);
			} else if (draft === null) {
				reset();
			} else {
				title.set(draft.title);
				description.set(draft.description);
				status.set(draft.status);
				priority.set(draft.priority);
				attachments.set(draft.attachments);
				uploads.set([]);
			}

			const [memberResult, labelResult, teamResult, repoResult] = await Promise.all([
				api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
			]);
			if (repoResult.error === undefined) {
				repositories.set(repoResult.data);
				// Either source names a repository by id, and either can name one that
				// has since been unlinked — which is dropped rather than restored as a
				// scope pointing at nothing.
				const wantedRepository =
					template !== null ? (template.repository?.id ?? null) : (draft?.repositoryId ?? null);
				const restored =
					repoResult.data.filter((repo) => repo.id === wantedRepository).map(toRepositoryRef)[0] ??
					null;
				// When nothing names a repository and the workspace has linked exactly
				// one, new issues scope to it by default — on the pill, where it can
				// be seen and cleared. A draft's empty scope is left alone: it may be
				// a deliberate clear.
				chosenRepository.set(
					restored ?? (draft === null ? soleRepositoryRef(repoResult.data) : null),
				);
			}
			if (memberResult.error === undefined) {
				members.set(memberResult.data);
				// Either source names a user by id, and either can name someone who
				// has since left — in which case the field is simply left empty.
				const wantedAssignee =
					template !== null ? (template.assignee?.id ?? null) : (draft?.assigneeId ?? null);
				if (template !== null || draft !== null) {
					assignee.set(
						wantedAssignee === null
							? null
							: (memberResult.data.find((member) => member.user.id === wantedAssignee)?.user ??
									null),
					);
				}
			}
			if (labelResult.error === undefined) {
				labels.set(labelResult.data);
				const wantedLabels =
					template !== null ? template.labels.map((label) => label.id) : (draft?.labelIds ?? null);
				if (wantedLabels !== null) {
					const kept = new Set(wantedLabels);
					chosenLabels.set(labelResult.data.filter((label) => kept.has(label.id)));
				}
			}

			if (teamResult.error !== undefined) return;
			teams.set(teamResult.data);

			// Draft team wins when it still exists; otherwise Engineering. With no
			// draft, open on the team you were looking at, then Engineering. A
			// template that pins no team is not an instruction to ignore where you
			// were — it falls through to the same defaults as a plain open.
			const wanted =
				template !== null
					? (template.team?.key ?? preferredTeam.get())
					: draft !== null
						? (draft.teamKey ?? "")
						: preferredTeam.get();
			chosenTeam.set(teamRefFor(teamResult.data, wanted));
		} finally {
			hydrating = false;
		}
	};

	const submit = async () => {
		// One create per request: the dialog-level shortcut can fire while a
		// create is already in flight, and must not file the issue twice.
		if (submitting.get()) return;
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
		// The draft belonged to the issue that now exists; a pending save of it
		// would only write it back.
		if (persistTimer !== undefined) {
			clearTimeout(persistTimer);
			persistTimer = undefined;
		}
		clearIssueDraft(slug.get());
		hasDraft.set(false);

		if (createMore.get()) {
			// Stay up, but as a fresh composer rather than a copy of what was just
			// filed: every field back to its default, cursor in the title.
			resetToDefaults();
			hydrating = false;
			focusTitle();
			return;
		}

		reset();
		open.set(false);
		hydrating = false;
	};

	const attach = (files: File[]) => {
		beginUploads({
			files,
			slug: slug.get(),
			uploads,
			onUploaded: (attachment) => {
				attachments.push(attachment);
				persist();
			},
		});
	};

	return Div(
		{ class: "contents" },
		FileDragOverlay({ enabled: open, onFiles: attach }),
		ImplementDocument({
			onKeydownCapture: (event) => {
				if (!open.get()) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				// Typing is typing: the title keeps its letters even while it is empty,
				// which is where `a` used to be stolen by the assignee menu. The
				// property letters still work anywhere focus is not in a field.
				if (isTyping(event)) return;
				const key = event.key.toLowerCase();
				const which =
					key === "s"
						? "status"
						: key === "p"
							? "priority"
							: key === "a"
								? "assignee"
								: key === "r"
									? "repository"
									: key === "l"
										? "label"
										: null;
				if (which === null) return;
				event.preventDefault();
				event.stopPropagation();
				openMenu(which);
			},
		}),
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
					attachments,
				],
				() => schedulePersist(),
				{ immediate: false },
			),
			DialogContent(
				{ class: "max-w-3xl gap-0 p-0 sm:max-w-3xl", showCloseButton: false },
				// Cmd/Ctrl+Enter files the issue from anywhere in the dialog — a
				// property pill, the Create button, an open picker — not just the
				// text fields. Capture phase so it runs ahead of whatever the
				// focused control does with Enter, and stopped so the title input's
				// copy of the shortcut cannot submit a second time. `submit` itself
				// declines while empty, teamless, or in flight. Attached by hand
				// because an element's `onKeydownCapture` prop binds a bogus
				// "keydowncapture" event instead of the capture phase
				// (implementjs ENG-24).
				ImplementLifecycle({
					onMount: (mounted) => {
						const root = mounted.closest<HTMLElement>("[data-slot='dialog-content']") ?? mounted;
						const onKeydown = (event: KeyboardEvent) => {
							if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
							event.preventDefault();
							event.stopPropagation();
							void submit();
						};
						root.addEventListener("keydown", onKeydown, true);
						return () => root.removeEventListener("keydown", onKeydown, true);
					},
				}),
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
					BodyComposer({
						value: description,
						element: descriptionRef,
						// `@` in the description searches the linked repositories' file index.
						slug: () => slug.get(),
						repository: () => chosenRepository.get()?.id,
						placeholder: "Add description… @ to reference a file",
						rows: 4,
						onSubmit: () => void submit(),
					}),
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
						open: statusOpen,
					}),
					PriorityPicker(priority, (value) => priority.set(value), {
						showLabel: true,
						class: "border border-border",
						open: priorityOpen,
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
						{ showLabel: true, class: "border border-border", open: assigneeOpen },
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
											.map(toRepositoryRef)[0] ?? null),
							),
						{ class: "border border-border", open: repositoryOpen },
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
						{ class: "border border-border", open: labelOpen },
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
					ControlLabel(
						{
							for: "create-more",
							class: "gap-2 pr-1 text-[12px] font-normal text-muted-foreground",
						},
						Switch({
							id: "create-more",
							checked: createMore,
							onCheckedChange: (checked) => saveCreateMore(checked),
						}),
						"Create more",
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
