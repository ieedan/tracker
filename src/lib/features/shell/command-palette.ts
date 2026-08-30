// ⌘K. Navigation, issue actions, and theme — the small set of things worth
// reaching without the mouse. Mounted once in the shell.
import { router } from "$implement/router";
import {
	Div,
	ForEach,
	If,
	ImplementDocument,
	ImplementEffect,
	Span,
	signal,
} from "@implementjs/core";
import { CircleUser, Inbox, LayoutList, Moon, Plus, Settings } from "@implementjs/lucide";
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
import { ResponsiveDialog, ResponsiveDialogContent } from "@/lib/components/ui/responsive-dialog";
import { StatusIcon } from "@/lib/components/glyphs";
import type { Issue } from "@/lib/domain/schemas";
import { mode } from "@/lib/mode";
import { tryOpenBulkCommandPalette } from "@/lib/features/issues/bulk-actions";
import { openCreateIssue } from "@/lib/features/issues/create-issue-dialog";

const open = signal(false);

export function openCommandPalette(): void {
	open.set(true);
}

export function CommandPalette(activeSlug: { get: () => string }) {
	const issues = signal<Issue[]>([]);
	const search = signal("");

	const load = async () => {
		const workspaceSlug = activeSlug.get();
		if (workspaceSlug === "") return;
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
					if (tryOpenBulkCommandPalette()) {
						open.set(false);
						return;
					}
					openCommandPalette();
				}
			},
		}),

		ResponsiveDialog(
			{ open },
			// The issues are loaded off `open` rather than off whatever opened the
			// palette: ⌘K is only one of the ways in — `/` and the sidebar button
			// are the others, and on a phone they are the only ones. Loading here
			// means every entrance gets the same list.
			ImplementEffect([open], (isOpen) => {
				if (isOpen) {
					void load();
					return;
				}
				search.set("");
			}),
			ResponsiveDialogContent(
				// No max-width override: the default keeps a phone's 1rem margins.
				{ class: "p-0", showCloseButton: false },
				Command(
					{ label: "Command palette", search },
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
										value: "inbox notifications",
										onSelect: () =>
											go(() => router.navigate("/app/:slug/inbox", { slug: activeSlug.get() })),
									},
									Inbox({ class: "size-3.5" }),
									"Inbox",
								),
								CommandItem(
									{
										// The words someone would actually type for it — the tab names
										// included, since all three land on the same screen.
										value: "my issues assigned created subscribed mine",
										onSelect: () =>
											go(() => router.navigate("/app/:slug/my-issues", { slug: activeSlug.get() })),
									},
									CircleUser({ class: "size-3.5" }),
									"My Issues",
								),
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
										value: "settings members labels api keys",
										onSelect: () =>
											go(() => router.navigate("/app/:slug/settings", { slug: activeSlug.get() })),
									},
									Settings({ class: "size-3.5" }),
									"Settings",
								),
							),
						),

						If(
							issues.bind((list) => list.length > 0),
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
		),
	);
}
