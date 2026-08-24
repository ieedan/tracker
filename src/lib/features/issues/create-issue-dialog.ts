// The composer. Opened from anywhere — the sidebar button, `c`, the command
// palette — so its open state lives at module scope and the dialog itself is
// mounted once, in the app shell.
import { derived, Div, ImplementEffect, Input, Span, Textarea, signal } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { Button } from "@/lib/components/ui/button";
import type { IssuePriority, IssueStatus } from "@/lib/domain/issues";
import type { Issue, Label, Member, Team, TeamRef } from "@/lib/domain/schemas";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker, TeamPicker } from "./pickers";

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
	const submitting = signal(false);

	// The pickers need the workspace's people and labels; they are fetched when
	// the composer opens rather than held by the shell, which does not have them.
	const members = signal<Member[]>([]);
	const labels = signal<Label[]>([]);
	const teams = signal<Team[]>([]);
	const chosenTeam = signal<TeamRef | null>(null);

	const reset = () => {
		title.set("");
		description.set("");
		status.set("backlog");
		priority.set("none");
		assignee.set(null);
		chosenLabels.set([]);
	};

	const loadContext = async (workspaceSlug: string) => {
		const [memberResult, labelResult, teamResult] = await Promise.all([
			api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
			api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
		]);
		if (memberResult.error === undefined) members.set(memberResult.data);
		if (labelResult.error === undefined) labels.set(labelResult.data);

		if (teamResult.error !== undefined) return;
		teams.set(teamResult.data);

		// Open on the team you were looking at; otherwise the first one.
		const wanted = preferredTeam.get();
		const picked =
			teamResult.data.find((team) => team.key === wanted) ?? teamResult.data[0] ?? null;
		chosenTeam.set(picked === null ? null : { id: picked.id, name: picked.name, key: picked.key });
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
				labelIds: chosenLabels.get().map((label) => label.id),
			},
		});
		submitting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the issue"));
			return;
		}

		issueCreated.set(data);
		toastSuccess(`Created ${data.identifier}`);
		reset();
		open.set(false);
	};

	return Dialog(
		{ open },
		ImplementEffect([open], (isOpen) => {
			if (isOpen) void loadContext(slug.get());
		}),
		DialogContent(
			{ class: "max-w-xl gap-0 p-0" },
			Div(
				{ class: "flex items-center gap-2 border-b border-border px-4 py-2.5" },
				Span(
					{
						class: "rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground",
					},
					chosenTeam.bind((team) => (team === null ? slug.get() : `${team.key}-•`)),
				),
				DialogTitle({ class: "text-[13px] font-medium" }, "New issue"),
			),

			Div(
				{ class: "flex flex-col gap-2 px-4 py-3" },
				Input({
					value: title,
					placeholder: "Issue title",
					class:
						"h-8 border-0 bg-transparent p-0 text-[15px] font-medium outline-none placeholder:text-muted-foreground",
					// Autofocus so `c` lands you straight on the title.
					autofocus: true,
					onKeydown: (event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
					},
				}),
				Textarea({
					value: description,
					placeholder: "Add description…",
					rows: 4,
					class:
						"resize-none border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted-foreground",
					onKeydown: (event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
					},
				}),
			),

			Div(
				{ class: "flex flex-wrap items-center gap-1.5 px-4 pb-3" },
				TeamPicker(
					chosenTeam,
					teams,
					(key) => {
						const picked = teams.get().find((team) => team.key === key);
						if (picked !== undefined) {
							chosenTeam.set({ id: picked.id, name: picked.name, key: picked.key });
						}
					},
					{ class: "border border-border" },
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
					members,
					(userId) =>
						assignee.set(
							userId === null
								? null
								: (members.get().find((member) => member.user.id === userId)?.user ?? null),
						),
					{ showLabel: true, class: "border border-border" },
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
				Span({ class: "mr-auto text-[11px] text-muted-foreground" }, "⌘↵ to create"),
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
					"Create issue",
				),
			),
		),
	);
}
