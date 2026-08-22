import { router } from "$implement/router";
import {
	Aside,
	Div,
	ForEach,
	Header,
	Implement,
	Main,
	Nav,
	Span,
	derived,
	navigateTo,
	signal,
} from "@implementjs/core";
import {
	ChevronsUpDownIcon,
	KeyRoundIcon,
	ListIcon,
	LogOutIcon,
	PenSquareIcon,
	PlusIcon,
	SettingsIcon,
	SunMoonIcon,
	UserIcon,
} from "@implementjs/lucide";
import { authApi } from "@/lib/api";
import { CommandPalette } from "@/lib/components/command-palette";
import { CreateIssueDialog } from "@/lib/components/create-issue-dialog";
import { initials, ReactiveUserAvatar } from "@/lib/components/issue-row";
import { Button } from "@/lib/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { env } from "@/lib/env.public";
import { mode } from "@/lib/mode";
import type { RealtimeEvent } from "@/lib/types";
import { WorkspaceContext, WorkspaceStore } from "@/lib/workspace-context";
import type { LayoutProps } from "./$types";

/**
 * The application shell: a sidebar, the workspace's event stream, and the two
 * global surfaces (the command palette and the new-issue dialog) that every
 * page below can open.
 */
export default function Layout({ children, data }: LayoutProps) {
	const store = new WorkspaceStore(data.get());
	const paletteOpen = signal(false);
	const newIssueOpen = signal(false);

	return WorkspaceContext.Provide(store).To(
		Implement.Head(Implement.Head.Title(`${data.get().workspace.name} · ${env.PUBLIC_APP_NAME}`)),

		// Navigating between workspaces reuses this layout, so the store is
		// reseeded rather than rebuilt — the stream below re-points off the signal.
		Implement.Watch([data], (next) => store.reseed(next)),

		EventStream(store),

		Implement.Document({
			onKeydown: (event) => {
				const target = event.target as HTMLElement | null;
				const typing =
					target !== null &&
					(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
					event.preventDefault();
					paletteOpen.set(!paletteOpen.get());
					return;
				}

				if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

				if (event.key === "c") {
					event.preventDefault();
					newIssueOpen.set(true);
				}
			},
		}),

		CommandPalette(store, paletteOpen, newIssueOpen),
		CreateIssueDialog(store, newIssueOpen),

		Div(
			{ class: "flex h-dvh overflow-hidden" },

			Aside(
				{ class: "hidden w-56 shrink-0 flex-col border-r bg-muted/30 md:flex" },

				// The switcher owns the workspace-level actions, the way Linear
				// hangs settings and sign-out off the same control.
				Div(
					{ class: "flex items-center gap-1 px-2 py-2" },
					DropdownMenu(
						DropdownMenuTrigger(
							{
								class:
									"flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-accent",
							},
							Span(
								{
									class:
										"flex size-5 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground",
								},
								store.workspace.bind((workspace) => initials(workspace.name)),
							),
							Span({ class: "min-w-0 flex-1 truncate" }, store.workspace.bind("name")),
							ChevronsUpDownIcon({ class: "size-3.5 shrink-0 text-muted-foreground" }),
						),
						DropdownMenuContent(
							{ align: "start", class: "w-60" },
							DropdownMenuGroup(
								DropdownMenuGroupHeading("Workspace"),
								DropdownMenuItem(
									{
										onSelect: () =>
											router.navigate("/:workspace/settings", {
												workspace: store.workspace.get().slug,
											}),
									},
									SettingsIcon({ class: "size-4" }),
									"Settings",
								),
							),
							DropdownMenuSeparator(),
							DropdownMenuGroup(
								DropdownMenuGroupHeading("Switch workspace"),
								ForEach(
									store.workspaces,
									(workspace) => workspace.id,
									(workspace) =>
										DropdownMenuItem(
											{
												onSelect: () =>
													router.navigate("/:workspace", { workspace: workspace.get().slug }),
											},
											Span({ class: "truncate" }, workspace.bind("name")),
											Span(
												{ class: "ml-auto text-xs text-muted-foreground" },
												workspace
													.bind("type")
													.bind((type) => (type === "User" ? "personal" : "org")),
											),
										),
								),
							),
						),
					),
					Button(
						{
							variant: "ghost",
							size: "icon-sm",
							class: "shrink-0 text-muted-foreground",
							"aria-label": "New issue",
							title: "New issue (C)",
							onClick: () => newIssueOpen.set(true),
						},
						PenSquareIcon({ class: "size-4" }),
					),
				),

				Nav(
					{ class: "flex flex-1 flex-col gap-0.5 px-2 py-1" },
					SidebarLink(store.workspace.get().slug, "/:workspace", ListIcon, "All issues"),
					MyIssuesLink(store),
				),

				Div(
					{ class: "border-t p-2" },
					DropdownMenu(
						DropdownMenuTrigger(
							{
								class:
									"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
							},
							ReactiveUserAvatar(store.user),
							Span(
								{ class: "min-w-0 flex-1 truncate" },
								store.user.bind((user) => user?.name ?? "Account"),
							),
						),
						DropdownMenuContent(
							{ align: "start", class: "w-56" },
							DropdownMenuGroup(
								DropdownMenuGroupHeading("Account"),
								DropdownMenuItem(
									{
										onSelect: () =>
											router.navigate("/:workspace/settings/preferences", {
												workspace: store.workspace.get().slug,
											}),
									},
									SettingsIcon({ class: "size-4" }),
									"Preferences",
								),
								DropdownMenuItem(
									{
										onSelect: () =>
											router.navigate("/:workspace/settings/api-keys", {
												workspace: store.workspace.get().slug,
											}),
									},
									KeyRoundIcon({ class: "size-4" }),
									"API keys",
								),
							),
							DropdownMenuSeparator(),
							// The label deliberately does not name the target mode: the
							// server has no OS to ask, so anything mode-dependent here
							// renders differently on the client and costs a full re-render.
							DropdownMenuItem(
								{ onSelect: () => mode.toggleMode() },
								SunMoonIcon({ class: "size-4" }),
								"Toggle theme",
							),
							DropdownMenuItem(
								{
									onSelect: async () => {
										await authApi.signOut();
										window.location.href = "/login";
									},
								},
								LogOutIcon({ class: "size-4" }),
								"Sign out",
							),
						),
					),
				),
			),

			Div(
				{ class: "flex min-w-0 flex-1 flex-col" },
				Header(
					{ class: "flex items-center gap-2 border-b px-4 py-2.5 md:hidden" },
					Span({ class: "text-sm font-medium" }, store.workspace.bind("name")),
					Button(
						{ class: "ml-auto", size: "sm", onClick: () => newIssueOpen.set(true) },
						PlusIcon({ class: "size-4" }),
					),
				),
				Main({ class: "flex min-h-0 flex-1 flex-col" }, children),
			),
		),
	);
}

function SidebarLink(
	workspace: string,
	to: "/:workspace",
	icon: (props: { class: string }) => unknown,
	label: string,
) {
	return router.Link(
		{
			to,
			params: { workspace },
			class:
				"flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
		},
		icon({ class: "size-4" }) as never,
		label,
	);
}

/**
 * "My issues" is the all-issues view with one filter applied, so it is a link
 * to that URL rather than a screen of its own — and the filter bar shows the
 * chip, which is how you know why the list is short.
 */
function MyIssuesLink(store: WorkspaceStore) {
	const href = derived([store.workspace, store.user], (workspace, user) =>
		user === null ? `/${workspace.slug}` : `/${workspace.slug}?assignee=${user.id}`,
	);

	return Button(
		{
			variant: "ghost",
			class:
				"h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm font-normal text-muted-foreground hover:text-foreground",
			onClick: () => navigateTo(href.get()),
		},
		UserIcon({ class: "size-4" }),
		"My issues",
	);
}

/**
 * Holds the workspace's event stream open for as long as the shell is mounted,
 * reconnecting when the browser drops it and re-pointing when the workspace
 * changes.
 */
function EventStream(store: WorkspaceStore) {
	return Implement.Lifecycle({
		onMount: () => {
			let source: EventSource | null = null;

			const connect = (slug: string) => {
				source?.close();
				source = new EventSource(`/api/v1/workspaces/${encodeURIComponent(slug)}/events`);

				source.addEventListener("open", () => store.live.set(true));
				source.addEventListener("error", () => store.live.set(false));

				for (const type of [
					"issue.created",
					"issue.updated",
					"issue.deleted",
					"comment.created",
					"comment.deleted",
				]) {
					source.addEventListener(type, (event) => {
						store.live.set(true);
						store.emit(JSON.parse((event as MessageEvent<string>).data) as RealtimeEvent);
					});
				}
			};

			connect(store.workspace.get().slug);
			const unsubscribe = store.workspace.onChange((next, previous) => {
				if (next.slug !== previous.slug) connect(next.slug);
			});

			return () => {
				unsubscribe();
				source?.close();
				store.live.set(false);
			};
		},
	});
}
