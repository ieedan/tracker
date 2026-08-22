import { router } from "$implement/router";
import { Div, If, Span, signal, type Signal } from "@implementjs/core";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/lib/components/ui/badge";
import { Button } from "@/lib/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/lib/components/ui/dialog";
import { Input } from "@/lib/components/ui/input";
import { Editor } from "@/lib/components/editor";
import {
	AssigneeSelect,
	PrioritySelect,
	RepoSelect,
	StatusSelect,
} from "@/lib/components/property-select";
import { toast } from "@/lib/toast";

import type { WorkspaceStore } from "@/lib/workspace-context";

/** The "new issue" modal. `open` is owned by the caller so `c` can drive it. */
export function CreateIssueDialog(store: WorkspaceStore, open: Signal<boolean>) {
	const title = signal("");
	const description = signal("");
	// The Select primitive drives a `Signal<string | null>`, where null is "nothing chosen".
	const statusId = signal<string | null>(null);
	const repoId = signal<string | null>("none");
	const assigneeId = signal<string | null>("none");
	const priority = signal<string | null>("0");
	const labelIds = signal<string[]>([]);
	const saving = signal(false);

	const reset = () => {
		title.set("");
		description.set("");
		statusId.set(store.defaultStatus()?.id ?? null);
		repoId.set("none");
		assigneeId.set("none");
		priority.set("0");
		labelIds.set([]);
	};

	// Opening is the moment the form should be blank, not closing — a failed
	// submit leaves what was typed in place.
	open.onChange((isOpen) => {
		if (isOpen) reset();
	});

	const submit = async () => {
		if (title.get().trim() === "") return;
		saving.set(true);
		try {
			const issue = await api.issues.create(store.workspace.get().slug, {
				title: title.get().trim(),
				description: description.get(),
				statusId: statusId.get() ?? undefined,
				repoId: repoId.get() === "none" ? null : repoId.get(),
				assigneeId: assigneeId.get() === "none" ? null : assigneeId.get(),
				priority: Number(priority.get() ?? 0),
				labelIds: labelIds.get(),
			});

			open.set(false);
			toast.add({
				title: `Created ${issue.identifier}`,
				data: {
					action: {
						label: "Open",
						onClick: () =>
							router.navigate("/:workspace/issue/:identifier", {
								workspace: store.workspace.get().slug,
								identifier: issue.identifier,
							}),
					},
				},
			});
		} catch (thrown) {
			toast.add({
				title: "Could not create the issue",
				description: thrown instanceof ApiError ? thrown.message : "Something went wrong",
				type: "error",
			});
		} finally {
			saving.set(false);
		}
	};

	return Dialog(
		{ open },
		DialogContent(
			{ class: "sm:max-w-2xl" },
			DialogTitle({ class: "sr-only" }, "New issue"),

			Div(
				{ class: "flex items-center gap-2 text-xs text-muted-foreground" },
				Badge({ variant: "outline" }, store.workspace.bind("slug")),
				Span("New issue"),
			),

			Input({
				value: title,
				placeholder: "Issue title — markdown works here too",
				class: "border-0 px-0 text-base shadow-none focus-visible:ring-0 md:text-base",
				autofocus: true,
				onKeydown: (event) => {
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
				},
			}),

			Editor({
				value: description,
				workspace: store.workspace.get().slug,
				placeholder: "Add a description…",
				class: "border-0 shadow-none focus-within:ring-0",
				onSubmit: () => void submit(),
			}),

			Div(
				{ class: "flex flex-wrap items-center gap-2" },

				StatusSelect({ value: statusId, statuses: store.statuses, class: "w-auto" }),
				PrioritySelect({ value: priority, class: "w-auto" }),
				AssigneeSelect({ value: assigneeId, members: store.members, class: "w-auto" }),
				RepoSelect({ value: repoId, repos: store.repos, class: "w-auto" }),

				Div(
					{ class: "ml-auto flex items-center gap-2" },
					Button({ variant: "ghost", onClick: () => open.set(false) }, "Cancel"),
					Button(
						{
							disabled: saving,
							onClick: () => void submit(),
						},
						If(saving).Then("Creating…").Else("Create issue"),
					),
				),
			),
		),
	);
}
