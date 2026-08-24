// ⌘K. Navigation, issue actions, and theme — the small set of things worth
// reaching without the mouse. Mounted once in the shell.
import { router } from "$implement/router";
import { Div, ForEach, ImplementDocument, Span, signal } from "@implementjs/core";
import { Inbox, LayoutList, Moon, Plus, Settings } from "@implementjs/lucide";
import { api } from "@/lib/client/api";
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
import { Dialog, DialogContent } from "@/lib/components/ui/dialog";
import { StatusIcon } from "@/lib/components/glyphs";
import type { Issue } from "@/lib/domain/schemas";
import { mode } from "@/lib/mode";
import { openCreateIssue } from "@/lib/features/issues/create-issue-dialog";

const open = signal(false);
const slug = signal("");

export function openCommandPalette(workspaceSlug?: string): void {
	if (workspaceSlug !== undefined && workspaceSlug !== "") slug.set(workspaceSlug);
	open.set(true);
}

export function CommandPalette(activeSlug: { get: () => string }) {
	const issues = signal<Issue[]>([]);

	const load = async () => {
		const workspaceSlug = activeSlug.get();
		if (workspaceSlug === "") return;
		slug.set(workspaceSlug);
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/issues", {
			params: { slug: workspaceSlug },
		});
		if (error === undefined) issues.set(data);
	};

	const go = (run: () => void) => {
		open.set(false);
		run();
	};

	return Div(
		{ class: "contents" },

		ImplementDocument({
			onKeydown: (event) => {
				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
					event.preventDefault();
					void load();
					open.set(true);
				}
			},
		}),

		Dialog(
			{ open },
			DialogContent(
				{ class: "max-w-lg p-0", showCloseButton: false },
				Command(
					{ label: "Command palette" },
					CommandInput({ placeholder: "Search issues or run a command…" }),
					CommandList(
						CommandEmpty("Nothing found."),

						CommandGroup(
							CommandGroupHeading("Actions"),
							CommandGroupItems(
								CommandItem(
									{
										value: "new issue create",
										onSelect: () => go(() => openCreateIssue(activeSlug.get())),
									},
									Plus({ class: "size-3.5" }),
									"New issue",
									Span({ class: "ml-auto text-[11px] text-muted-foreground" }, "C"),
								),
								CommandItem(
									{ value: "toggle theme dark light", onSelect: () => go(() => mode.toggleMode()) },
									Moon({ class: "size-3.5" }),
									"Toggle theme",
								),
							),
						),

						CommandGroup(
							CommandGroupHeading("Go to"),
							CommandGroupItems(
								CommandItem(
									{
										value: "issues list",
										onSelect: () =>
											go(() => router.navigate("/app/:slug", { slug: activeSlug.get() })),
									},
									LayoutList({ class: "size-3.5" }),
									"Issues",
								),
								CommandItem(
									{
										value: "inbox notifications",
										onSelect: () =>
											go(() => router.navigate("/app/:slug/inbox", { slug: activeSlug.get() })),
									},
									Inbox({ class: "size-3.5" }),
									"Inbox",
								),
								CommandItem(
									{
										value: "settings members labels api keys",
										onSelect: () =>
											go(() => router.navigate("/app/:slug/settings", { slug: activeSlug.get() })),
									},
									Settings({ class: "size-3.5" }),
									"Settings",
								),
							),
						),

						CommandGroup(
							CommandGroupHeading("Issues"),
							CommandGroupItems(
								ForEach(
									issues,
									(issue) => issue.id,
									(issue) =>
										CommandItem(
											{
												value: `${issue.get().identifier} ${issue.get().title}`,
												onSelect: () =>
													go(() =>
														router.navigate("/app/:slug/issue/:identifier", {
															slug: activeSlug.get(),
															identifier: issue.get().identifier,
														}),
													),
											},
											StatusIcon(issue.bind("status")),
											Span(
												{ class: "w-14 shrink-0 font-mono text-[11px] text-muted-foreground" },
												issue.bind("identifier"),
											),
											Span({ class: "truncate" }, issue.bind("title")),
										),
								),
							),
						),
					),
				),
			),
		),
	);
}
