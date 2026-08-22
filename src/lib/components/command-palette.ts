import { router } from "$implement/router";
import { Div, ForEach, Span, derived, signal, type Signal } from "@implementjs/core";
import { PlusIcon, SearchIcon, SettingsIcon, WebhookIcon } from "@implementjs/lucide";
import { api } from "@/lib/api";
import { InlineMarkdown } from "@/lib/components/markdown";
import { StatusIcon } from "@/lib/components/status-icon";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandGroupHeading,
	CommandGroupItems,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/lib/components/ui/dialog";
import { mode } from "@/lib/mode";
import type { IssueDto } from "@/lib/types";
import type { WorkspaceStore } from "@/lib/workspace-context";

/**
 * Cmd-K. Jumps to an issue, switches workspace, or runs one of the handful of
 * actions worth reaching without the mouse.
 */
export function CommandPalette(
	store: WorkspaceStore,
	open: Signal<boolean>,
	newIssue: Signal<boolean>,
) {
	const query = signal("");
	const matches = signal<IssueDto[]>([]);

	let sequence = 0;
	const search = async (text: string) => {
		const ticket = ++sequence;
		const page = await api.issues.list(store.workspace.get().slug, { q: text, limit: 12 });
		// A slower earlier request must not overwrite a faster later one.
		if (ticket === sequence) matches.set(page.items);
	};

	let debounce: ReturnType<typeof setTimeout> | undefined;
	query.onChange((text) => {
		clearTimeout(debounce);
		debounce = setTimeout(() => void search(text), 150);
	});

	open.onChange((isOpen) => {
		if (!isOpen) return;
		query.set("");
		void search("");
	});

	const go = (run: () => void) => () => {
		open.set(false);
		run();
	};

	const otherWorkspaces = derived([store.workspaces, store.workspace], (all, current) =>
		all.filter((item) => item.slug !== current.slug),
	);

	return Dialog(
		{ open },
		DialogContent(
			{ class: "overflow-hidden p-0 sm:max-w-xl", showCloseButton: false },
			DialogTitle({ class: "sr-only" }, "Command palette"),
			Command(
				{ label: "Command palette" },
				// Deliberately not `value: query` — the primitive two-way binds its own
				// search signal through `value`, and overriding it turns off the
				// palette's filtering of actions and workspaces. Mirroring the text
				// out through `onInput` leaves that intact and still drives the
				// server-side issue search below.
				CommandInput({
					placeholder: "Search issues, or jump to…",
					onInput: (event) => query.set(event.target.value),
				}),
				CommandList(
					CommandEmpty("No matches."),

					CommandGroup(
						CommandGroupHeading("Actions"),
						CommandGroupItems(
							CommandItem(
								{ value: "new issue", onSelect: go(() => newIssue.set(true)) },
								PlusIcon({ class: "size-4" }),
								"New issue",
							),
							CommandItem(
								{
									value: "settings labels statuses",
									onSelect: go(() =>
										router.navigate("/:workspace/settings", {
											workspace: store.workspace.get().slug,
										}),
									),
								},
								SettingsIcon({ class: "size-4" }),
								"Workspace settings",
							),
							CommandItem(
								{
									value: "webhooks",
									onSelect: go(() =>
										router.navigate("/:workspace/settings/webhooks", {
											workspace: store.workspace.get().slug,
										}),
									),
								},
								WebhookIcon({ class: "size-4" }),
								"Webhooks",
							),
							CommandItem(
								{ value: "toggle theme dark light", onSelect: go(() => mode.toggleMode()) },
								SearchIcon({ class: "size-4" }),
								"Toggle theme",
							),
						),
					),

					CommandGroup(
						CommandGroupHeading("Issues"),
						CommandGroupItems(
							ForEach(
								matches,
								(issue) => issue.id,
								(issue) =>
									CommandItem(
										{
											value: `${issue.get().identifier} ${issue.get().title}`,
											onSelect: go(() =>
												router.navigate("/:workspace/issue/:identifier", {
													workspace: store.workspace.get().slug,
													identifier: issue.get().identifier,
												}),
											),
										},
										Div({ class: "contents" }, StatusIcon(issue.get().status)),
										Span(
											{ class: "w-20 shrink-0 font-mono text-xs text-muted-foreground" },
											issue.bind("identifier"),
										),
										InlineMarkdown(issue.bind("titleHtml"), "min-w-0 flex-1 truncate"),
									),
							),
						),
					),

					CommandGroup(
						CommandGroupHeading("Switch workspace"),
						CommandGroupItems(
							ForEach(
								otherWorkspaces,
								(item) => item.id,
								(item) =>
									CommandItem(
										{
											value: `workspace ${item.get().slug}`,
											onSelect: go(() =>
												router.navigate("/:workspace", { workspace: item.get().slug }),
											),
										},
										item.bind("name"),
										Span({ class: "text-xs text-muted-foreground" }, item.bind("slug")),
									),
							),
						),
					),
				),
			),
		),
	);
}
