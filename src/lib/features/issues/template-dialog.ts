// The template composer. A template is nothing but a set of prefills the issue
// composer opens on, so this is the issue composer with the same fields in the
// same places — plus the two things only a template has, a name and a
// description, and placeholders standing in for what a new issue would say.
//
// Opened from the New issue split button, so its open state lives at module
// scope and the dialog itself is mounted once, in the app shell.
import {
	Div,
	If,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	P,
	Span,
	derived,
	signal,
} from "@implementjs/core";
import { X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { Button } from "@/lib/components/ui/button";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "@/lib/components/ui/breadcrumb";
import { DialogClose, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { Label as ControlLabel } from "@/lib/components/ui/label";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/lib/components/ui/responsive-dialog";
import { toastError, toastSuccess } from "@/lib/client/toast";
import type { IssuePriority, IssueStatus } from "@/lib/domain/issues";
import type { IssueTemplate, Label, Member, Repository, Team, TeamRef } from "@/lib/domain/schemas";
import { BodyComposer } from "./body-composer";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker, TeamPicker } from "./pickers";
import { RepositoryPicker, toRepositoryRef, type RepositoryRef } from "./repository-picker";

const open = signal(false);
const slug = signal("");
/** The template being edited, or null when the dialog is creating one. */
const editing = signal<IssueTemplate | null>(null);

/**
 * Bumped whenever a template is created, saved or deleted.
 *
 * The New issue menu holds its own copy of the list — it is mounted twice, once
 * per sidebar shape — so it watches this rather than being handed the change.
 */
export const templatesChanged = signal(0);

export function openCreateTemplate(workspaceSlug: string): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	editing.set(null);
	open.set(true);
}

export function openEditTemplate(workspaceSlug: string, template: IssueTemplate): void {
	if (workspaceSlug === "") return;
	slug.set(workspaceSlug);
	editing.set(template);
	open.set(true);
}

const inputClass =
	"h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus:border-ring";

export function TemplateDialog() {
	const name = signal("");
	const summary = signal("");
	const title = signal("");
	const description = signal("");
	const team = signal<TeamRef | null>(null);
	const status = signal<IssueStatus>("backlog");
	const priority = signal<IssuePriority>("none");
	const assignee = signal<Member["user"] | null>(null);
	const repository = signal<RepositoryRef | null>(null);
	const chosenLabels = signal<Label[]>([]);
	const saving = signal(false);
	const deleting = signal(false);
	/** Delete asks once: the button relabels rather than opening a second modal. */
	const confirmingDelete = signal(false);

	// What the pickers offer. Fetched on open rather than held by the shell,
	// which has the teams but not the members, labels or repositories.
	const teams = signal<Team[]>([]);
	const members = signal<Member[]>([]);
	const labels = signal<Label[]>([]);
	const repositories = signal<Repository[]>([]);

	const nameInput = signal<HTMLInputElement | null>(null);
	let focusFrame: number | undefined;

	const statusOpen = signal(false);
	const priorityOpen = signal(false);
	const assigneeOpen = signal(false);
	const repositoryOpen = signal(false);
	const labelOpen = signal(false);

	/** Seeds every field from the template being edited, or clears them all. */
	const hydrate = (template: IssueTemplate | null) => {
		name.set(template?.name ?? "");
		summary.set(template?.summary ?? "");
		title.set(template?.title ?? "");
		description.set(template?.description ?? "");
		team.set(template?.team ?? null);
		status.set(template?.status ?? "backlog");
		priority.set(template?.priority ?? "none");
		assignee.set(template?.assignee ?? null);
		repository.set(template?.repository ?? null);
		chosenLabels.set(template?.labels ?? []);
		confirmingDelete.set(false);
	};

	/**
	 * The pickers' options. A template can name a team, an assignee, a
	 * repository or labels that have since been deleted — those come back on the
	 * template itself, so the pills still read correctly while these land.
	 */
	const loadCatalog = async (workspaceSlug: string) => {
		const [teamResult, memberResult, labelResult, repoResult] = await Promise.all([
			api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
		]);
		if (teamResult.error === undefined) teams.set(teamResult.data);
		if (memberResult.error === undefined) members.set(memberResult.data);
		if (labelResult.error === undefined) labels.set(labelResult.data);
		if (repoResult.error === undefined) repositories.set(repoResult.data);
	};

	const submit = async () => {
		if (saving.get()) return;
		const trimmed = name.get().trim();
		if (trimmed === "") return;

		const body = {
			name: trimmed,
			summary: summary.get().trim(),
			title: title.get().trim(),
			description: description.get(),
			teamKey: team.get()?.key ?? null,
			status: status.get(),
			priority: priority.get(),
			assigneeId: assignee.get()?.id ?? null,
			repositoryId: repository.get()?.id ?? null,
			labelIds: chosenLabels.get().map((label) => label.id),
		};

		saving.set(true);
		const current = editing.get();
		const result =
			current === null
				? await api.POST("/api/v1/workspaces/[slug]/templates", {
						params: { slug: slug.get() },
						body,
					})
				: await api.PATCH("/api/v1/workspaces/[slug]/templates/[id]", {
						params: { slug: slug.get(), id: current.id },
						body,
					});
		saving.set(false);

		if (result.error !== undefined) {
			toastError(messageOf(result.error, "Could not save the template"));
			return;
		}

		templatesChanged.update((value) => value + 1);
		toastSuccess(current === null ? `Created ${result.data.name}` : "Template saved");
		open.set(false);
	};

	const remove = async () => {
		const current = editing.get();
		if (current === null || deleting.get()) return;

		deleting.set(true);
		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/templates/[id]", {
			params: { slug: slug.get(), id: current.id },
		});
		deleting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not delete the template"));
			return;
		}

		templatesChanged.update((value) => value + 1);
		toastSuccess(`Deleted ${current.name}`);
		open.set(false);
	};

	return ResponsiveDialog(
		{ open },
		ImplementEffect([open], (isOpen) => {
			if (focusFrame !== undefined) {
				cancelAnimationFrame(focusFrame);
				focusFrame = undefined;
			}
			if (!isOpen) return;
			hydrate(editing.get());
			void loadCatalog(slug.get());
			// The dialog focuses the first tabbable, which is the team crumb. Steal
			// it back once that pass has run, so you can type a name.
			focusFrame = requestAnimationFrame(() => {
				focusFrame = undefined;
				nameInput.get()?.focus();
			});
		}),
		ResponsiveDialogContent(
			{ class: "gap-0 p-0 md:max-w-3xl", showCloseButton: false },

			// ⌘⏎ saves from anywhere in the dialog, the way it files an issue from
			// the composer. Attached by hand because `onKeydownCapture` on an
			// element binds a bogus "keydowncapture" event (implementjs ENG-24).
			ImplementLifecycle({
				onMount: (mounted) => {
					const root =
						mounted.closest<HTMLElement>(
							"[data-slot='dialog-content'], [data-slot='drawer-content']",
						) ?? mounted;
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
								team,
								teams,
								(key) => {
									const picked = teams.get().find((entry) => entry.key === key);
									if (picked !== undefined) {
										team.set({
											id: picked.id,
											name: picked.name,
											key: picked.key,
											icon: picked.icon,
											color: picked.color,
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
								editing.bind((value) => (value === null ? "New template" : "Edit template")),
							),
						),
					),
				),
				DialogClose(
					{ variant: "ghost", size: "icon-sm", class: "size-7 shrink-0" },
					X({ class: "size-4", "aria-hidden": true }),
					Span({ class: "sr-only" }, "Close"),
				),
			),

			Div(
				{ class: "flex max-h-[70vh] flex-col overflow-y-auto" },

				// What the template is called, and when to reach for it. Neither
				// ever lands on an issue, which is why they sit apart from the
				// fields below rather than among them.
				Div(
					{ class: "flex flex-col gap-2.5 border-b border-border bg-secondary/30 px-4 py-3" },
					Div(
						{ class: "flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3" },
						ControlLabel(
							{ for: "template-name", class: "w-24 shrink-0 text-[12px] text-muted-foreground" },
							"Name",
						),
						Input({
							this: nameInput,
							id: "template-name",
							value: name,
							placeholder: "Bug report",
							class: inputClass,
						}),
					),
					Div(
						{ class: "flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3" },
						ControlLabel(
							{ for: "template-summary", class: "w-24 shrink-0 text-[12px] text-muted-foreground" },
							"Description",
						),
						Input({
							id: "template-summary",
							value: summary,
							placeholder: "When to reach for this template (optional)",
							class: inputClass,
						}),
					),
				),

				// From here down it is the issue composer: what a new issue starts
				// out with, shown where it will appear.
				Div(
					{ class: "flex flex-col gap-2 px-4 py-3" },
					Input({
						id: "template-title",
						value: title,
						placeholder: "Issue title — left blank, the composer starts empty",
						class:
							"h-8 border-0 bg-transparent p-0 text-[15px] font-medium outline-none placeholder:text-muted-foreground",
					}),
					BodyComposer({
						value: description,
						slug: () => slug.get(),
						repository: () => repository.get()?.id,
						placeholder: "## Steps to reproduce\n\n## Expected\n\n## Actual",
						rows: 6,
						toolbar: true,
						onSubmit: () => void submit(),
					}),
				),

				Div(
					{ class: "flex flex-wrap items-center gap-1.5 px-4 pb-2" },
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
						repository,
						repositories,
						(repositoryId) =>
							repository.set(
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
					If(
						team.bind((value) => value !== null),
						Button(
							{
								size: "xs",
								variant: "ghost",
								class: "text-[11px] text-muted-foreground",
								onClick: () => team.set(null),
							},
							"Clear team",
						),
					),
				),

				P(
					{ class: "px-4 pb-3 text-[11px] text-muted-foreground" },
					"Leave the team unset to open the composer on whichever team you were looking at.",
				),
			),

			DialogDescription(
				{ class: "sr-only" },
				"What a new issue starts out with when someone picks this template.",
			),

			Div(
				{
					class: "flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5",
				},
				If(
					editing.bind((value) => value !== null),
					Div(
						{ class: "mr-auto flex items-center gap-2" },
						// `variant` is not bindable, so the destructive look is painted
						// on by class rather than by swapping the button for another one,
						// which would also drop the focus the first press just took.
						Button(
							{
								size: "sm",
								variant: "ghost",
								loading: deleting,
								class: confirmingDelete.bind((asked) =>
									asked
										? "bg-destructive text-white hover:bg-destructive/90"
										: "text-muted-foreground hover:text-destructive",
								),
								onClick: () => {
									if (confirmingDelete.get()) void remove();
									else confirmingDelete.set(true);
								},
							},
							confirmingDelete.bind((asked) => (asked ? "Delete template" : "Delete")),
						),
						If(
							confirmingDelete,
							Button(
								{
									size: "sm",
									variant: "ghost",
									class: "text-[12px] text-muted-foreground",
									onClick: () => confirmingDelete.set(false),
								},
								"Keep",
							),
						),
					),
				),
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						loading: saving,
						disabled: derived([name], (value) => value.trim() === ""),
						onClick: () => void submit(),
					},
					editing.bind((value) => (value === null ? "Create template" : "Save")),
					Span({ class: "text-[11px] font-normal opacity-70" }, "⌘⏎"),
				),
			),
		),
	);
}
