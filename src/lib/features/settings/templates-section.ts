// Issue templates: the saved starting points that show up under New issue.
// Managed here at the workspace level, the way Linear does it — a template is
// nothing but a set of prefills the composer opens on.
import {
	Div,
	ForEach,
	H2,
	If,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	P,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/lib/components/ui/responsive-dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
// Aliased: `Label` is the issue-label type everywhere else in this feature.
import { Label as ControlLabel } from "@/lib/components/ui/label";
import { Textarea } from "@/lib/components/ui/textarea";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/domain/issues";
import type { IssuePriority, IssueStatus } from "@/lib/domain/issues";
import type { IssueTemplate, Label, Member, Repository, Team, TeamRef } from "@/lib/domain/schemas";
import {
	AssigneePicker,
	LabelChips,
	LabelPicker,
	PriorityPicker,
	StatusPicker,
	TeamPicker,
} from "@/lib/features/issues/pickers";
import {
	RepositoryPicker,
	toRepositoryRef,
	type RepositoryRef,
} from "@/lib/features/issues/repository-picker";

const inputClass =
	"h-8 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring";

/** Everything the pickers need, fetched once when the section mounts. */
interface Catalog {
	teams: Signal<Team[]>;
	members: Signal<Member[]>;
	labels: Signal<Label[]>;
	repositories: Signal<Repository[]>;
}

export function TemplatesSection(slug: Readable<string>) {
	const templates = signal<IssueTemplate[]>([]);
	const loading = signal(true);
	const open = signal(false);
	/** The template the dialog is editing, or null when it is creating one. */
	const editing = signal<IssueTemplate | null>(null);

	const catalog: Catalog = {
		teams: signal<Team[]>([]),
		members: signal<Member[]>([]),
		labels: signal<Label[]>([]),
		repositories: signal<Repository[]>([]),
	};

	const load = async () => {
		const workspaceSlug = slug.get();
		const [templateResult, teamResult, memberResult, labelResult, repoResult] = await Promise.all([
			api.GET("/api/v1/workspaces/[slug]/templates", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
		]);
		loading.set(false);
		if (templateResult.error === undefined) templates.set(templateResult.data);
		if (teamResult.error === undefined) catalog.teams.set(teamResult.data);
		if (memberResult.error === undefined) catalog.members.set(memberResult.data);
		if (labelResult.error === undefined) catalog.labels.set(labelResult.data);
		if (repoResult.error === undefined) catalog.repositories.set(repoResult.data);
	};

	const remove = async (template: IssueTemplate) => {
		const before = templates.get();
		templates.set(before.filter((entry) => entry.id !== template.id));
		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/templates/[id]", {
			params: { slug: slug.get(), id: template.id },
		});
		if (error !== undefined) {
			templates.set(before);
			toastError(messageOf(error, "Could not delete the template"));
			return;
		}
		toastSuccess(`Deleted ${template.name}`);
	};

	const startCreate = () => {
		editing.set(null);
		open.set(true);
	};

	const startEdit = (template: IssueTemplate) => {
		editing.set(template);
		open.set(true);
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		ImplementLifecycle({ onMount: () => void load() }),

		Div(
			{ class: "flex items-start justify-between gap-3" },
			Div(
				{},
				H2({ class: "text-[14px] font-semibold" }, "Issue templates"),
				P(
					{ class: "text-[12px] text-muted-foreground" },
					"Saved starting points for a new issue. They appear next to New issue in the sidebar.",
				),
			),
			Button(
				{ size: "sm", class: "gap-1.5", onClick: startCreate },
				Plus({ class: "size-3.5" }),
				"New template",
			),
		),

		If(
			derived([loading, templates], (busy, list) => !busy && list.length > 0),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				ForEach(
					templates,
					(template) => template.id,
					(template) =>
						Div(
							{ class: "flex items-center gap-3 px-3 py-2.5" },
							Div(
								{ class: "flex min-w-0 flex-1 flex-col gap-1" },
								Span({ class: "truncate text-[13px] font-medium" }, template.bind("name")),
								Div(
									{ class: "flex flex-wrap items-center gap-1.5" },
									Span({ class: "text-[11px] text-muted-foreground" }, template.bind(summarize)),
									LabelChips(template.bind((value) => value.labels)),
								),
							),
							Button(
								{
									size: "icon-sm",
									variant: "ghost",
									title: "Edit",
									onClick: () => startEdit(template.get()),
								},
								Pencil({ class: "size-3.5" }),
							),
							Button(
								{
									size: "icon-sm",
									variant: "ghost",
									title: "Delete",
									onClick: () => void remove(template.get()),
								},
								Trash2({ class: "size-3.5" }),
							),
						),
				),
			),
		),

		If(
			derived([loading, templates], (busy, list) => !busy && list.length === 0),
			Empty(
				{ class: "border md:p-8" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, LayoutTemplate({ "aria-hidden": true })),
					EmptyTitle("No templates yet"),
					EmptyDescription(
						"Create one to start a bug report or a spike with its fields already filled in.",
					),
				),
			),
		),

		TemplateDialog(open, editing, slug, catalog, (saved) => {
			templates.update((current) => {
				const without = current.filter((entry) => entry.id !== saved.id);
				return [...without, saved].toSorted((a, b) => a.name.localeCompare(b.name));
			});
		}),
	);
}

/** The one-line "ENG · Todo · High · Alice · tracker" under a template's name. */
function summarize(template: IssueTemplate): string {
	const parts = [
		template.team === null ? null : template.team.key,
		STATUS_LABELS[template.status],
		template.priority === "none" ? null : PRIORITY_LABELS[template.priority],
		template.assignee?.name ?? null,
		template.repository === null
			? null
			: (template.repository.fullName.split("/")[1] ?? template.repository.fullName),
	].filter((part): part is string => part !== null);

	return template.summary === "" ? parts.join(" · ") : `${template.summary} — ${parts.join(" · ")}`;
}

function TemplateDialog(
	open: Signal<boolean>,
	editing: Readable<IssueTemplate | null>,
	slug: Readable<string>,
	catalog: Catalog,
	onSaved: (template: IssueTemplate) => void,
) {
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

	/** Seeds every field from the template being edited, or clears them. */
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
	};

	const submit = async () => {
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

		onSaved(result.data);
		toastSuccess(current === null ? `Created ${result.data.name}` : "Template saved");
		open.set(false);
	};

	return ResponsiveDialog(
		{ open },
		ImplementEffect([open], (isOpen) => {
			if (isOpen) hydrate(editing.get());
		}),
		ResponsiveDialogContent(
			{ class: "gap-0 p-0 md:max-w-lg" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle(
					{ class: "text-[15px] font-semibold" },
					editing.bind((value) => (value === null ? "New template" : "Edit template")),
				),
				DialogDescription(
					{ class: "text-[12px]" },
					"What a new issue starts out with when someone picks this template.",
				),
			),

			Div(
				{ class: "flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-4 py-4" },
				Div(
					{ class: "flex flex-col gap-1.5" },
					ControlLabel({ for: "template-name", class: "text-[13px]" }, "Template name"),
					Input({
						id: "template-name",
						value: name,
						placeholder: "Bug report",
						autofocus: true,
						class: inputClass,
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					ControlLabel({ for: "template-summary", class: "text-[13px]" }, "Description"),
					Input({
						id: "template-summary",
						value: summary,
						placeholder: "When to reach for this template (optional)",
						class: inputClass,
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					ControlLabel({ for: "template-title", class: "text-[13px]" }, "Issue title"),
					Input({
						id: "template-title",
						value: title,
						placeholder: "Prefilled title (optional)",
						class: inputClass,
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					ControlLabel({ for: "template-body", class: "text-[13px]" }, "Issue description"),
					Textarea({
						id: "template-body",
						value: description,
						rows: 6,
						placeholder: "## Steps to reproduce\n\n## Expected\n\n## Actual",
						class: "min-h-32 text-[13px]",
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Span({ class: "text-[13px] font-medium" }, "Defaults"),
					Div(
						{ class: "flex flex-wrap items-center gap-1.5" },
						TeamPicker(
							team,
							catalog.teams,
							(key) => {
								const picked = catalog.teams.get().find((entry) => entry.key === key);
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
							{ showLabel: true, class: "border border-border" },
						),
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
							catalog.members,
							(userId) =>
								assignee.set(
									userId === null
										? null
										: (catalog.members.get().find((member) => member.user.id === userId)?.user ??
												null),
								),
							{ showLabel: true, class: "border border-border" },
						),
						RepositoryPicker(
							repository,
							catalog.repositories,
							(repositoryId) =>
								repository.set(
									repositoryId === null
										? null
										: (catalog.repositories
												.get()
												.filter((repo) => repo.id === repositoryId)
												.map(toRepositoryRef)[0] ?? null),
								),
							{ class: "border border-border" },
						),
						LabelPicker(
							chosenLabels,
							catalog.labels,
							(labelId) =>
								chosenLabels.update((current) =>
									current.some((label) => label.id === labelId)
										? current.filter((label) => label.id !== labelId)
										: [...current, catalog.labels.get().find((label) => label.id === labelId)!],
								),
							{ class: "border border-border" },
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
						{ class: "text-[11px] text-muted-foreground" },
						"Leave the team unset to open the composer on whichever team you were looking at.",
					),
				),
			),

			Div(
				{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						loading: saving,
						disabled: name.bind((value) => value.trim() === ""),
						onClick: () => void submit(),
					},
					editing.bind((value) => (value === null ? "Create template" : "Save")),
				),
			),
		),
	);
}
