import { router } from "$implement/router";
import {
	Aside,
	Div,
	ForEach,
	If,
	ImplementLifecycle,
	Main,
	Span,
	derived,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import {
	ChevronDown,
	Inbox as InboxIcon,
	LayoutList,
	LogOut,
	Plus,
	Settings as SettingsIcon,
	SunMoon,
} from "@implementjs/lucide";
import { api } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth";
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
import { UserAvatar } from "@/lib/components/glyphs";
import type { Workspace } from "@/lib/domain/schemas";
import { mode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { CommandPalette, openCommandPalette } from "./command-palette";
import { CreateIssueDialog, openCreateIssue } from "@/lib/features/issues/create-issue-dialog";

export interface ShellData {
	user: App.SessionUser;
	workspaces: Workspace[];
	unread: number;
}

/** How often the inbox badge re-checks. Cheap query, and 15s reads as live. */
const POLL_MS = 15_000;

export function AppShell(
	data: Readable<ShellData>,
	url: Readable<{ path: string }>,
	children: Child,
) {
	const unread = signal(data.get().unread);

	// The badge is the one number on screen that must not go stale, so it polls
	// rather than waiting for the next navigation to reseed it.
	const poll = async () => {
		const { data: result, error } = await api.GET("/api/v1/notifications/unread");
		if (error === undefined) unread.set(result.count);
	};

	const activeSlug = derived([url, data], (location, shell) => {
		const match = /^\/app\/([^/]+)/.exec(location.path);
		return match?.[1] ?? shell.workspaces[0]?.slug ?? "";
	});

	return Div(
		{ class: "flex min-h-dvh" },
		ImplementLifecycle({
			onMount: () => {
				const timer = setInterval(() => void poll(), POLL_MS);
				// A tab that comes back to the foreground should catch up at once
				// instead of waiting out the rest of the interval.
				const onVisible = () => {
					if (document.visibilityState === "visible") void poll();
				};
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			},
		}),
		Sidebar(data, activeSlug, url, unread),
		Main({ class: "flex min-w-0 flex-1 flex-col bg-background" }, children),

		// Mounted once for the whole app: both are opened imperatively from
		// hotkeys, the sidebar and the palette itself.
		CreateIssueDialog(),
		CommandPalette(activeSlug),
	);
}

function Sidebar(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
	url: Readable<{ path: string }>,
	unread: Readable<number>,
) {
	return Aside(
		{
			class:
				"flex w-[232px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-3 py-3",
		},
		WorkspaceSwitcher(data, activeSlug),

		Button(
			{
				variant: "secondary",
				size: "sm",
				class: "mt-2 mb-2 w-full justify-start gap-2 text-[13px]",
				onClick: () => openCreateIssue(activeSlug.get()),
			},
			Plus({ class: "size-3.5" }),
			"New issue",
			Span({ class: "ml-auto text-[11px] text-muted-foreground" }, "C"),
		),

		NavItem(url, activeSlug, "/app/:slug/inbox", InboxIcon, "Inbox", unread),
		NavItem(url, activeSlug, "/app/:slug", LayoutList, "Issues"),
		NavItem(url, activeSlug, "/app/:slug/settings", SettingsIcon, "Settings"),

		Div({ class: "flex-1" }),

		Button(
			{
				variant: "ghost",
				size: "sm",
				class: "w-full justify-start gap-2 text-[13px] text-muted-foreground",
				onClick: () => openCommandPalette(),
			},
			Span({ class: "flex size-3.5 items-center justify-center text-[11px]" }, "⌘"),
			"Command palette",
			Span({ class: "ml-auto text-[11px]" }, "⌘K"),
		),
		UserMenu(data),
	);
}

function WorkspaceSwitcher(data: Readable<ShellData>, activeSlug: Readable<string>) {
	const current = derived([data, activeSlug], (shell, slug) =>
		shell.workspaces.find((workspace) => workspace.slug === slug),
	);

	return DropdownMenu(
		DropdownMenuTrigger(
			{
				variant: "ghost",
				class: "h-9 w-full justify-start gap-2 px-2 hover:bg-accent",
			},
			Div(
				{ class: "flex size-5 items-center justify-center rounded-[5px] bg-primary" },
				Span(
					{ class: "text-[10px] font-bold text-primary-foreground" },
					current.bind((workspace) => (workspace?.name ?? "?").slice(0, 1).toUpperCase()),
				),
			),
			Span(
				{ class: "truncate text-[13px] font-medium" },
				current.bind((workspace) => workspace?.name ?? "No workspace"),
			),
			ChevronDown({ class: "ml-auto size-3.5 text-muted-foreground" }),
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start" },
			DropdownMenuGroup(
				DropdownMenuGroupHeading("Workspaces"),
				ForEach(
					data.bind((shell) => shell.workspaces),
					(workspace) => workspace.id,
					(workspace) =>
						DropdownMenuItem(
							{
								onSelect: () => router.navigate("/app/:slug", { slug: workspace.get().slug }),
							},
							Span({ class: "truncate" }, workspace.bind("name")),
							Span({ class: "ml-auto text-[11px] text-muted-foreground" }, workspace.bind("key")),
						),
				),
			),
			DropdownMenuSeparator(),
			DropdownMenuItem(
				{ onSelect: () => window.location.assign("/app/new") },
				Plus({ class: "size-3.5" }),
				"Create workspace",
			),
		),
	);
}

type NavPath = "/app/:slug" | "/app/:slug/inbox" | "/app/:slug/settings";

function NavItem(
	url: Readable<{ path: string }>,
	activeSlug: Readable<string>,
	to: NavPath,
	Icon: typeof InboxIcon,
	label: string,
	badge?: Readable<number>,
) {
	const active = derived([url, activeSlug], (location, slug) => {
		const target = to.replace(":slug", slug);
		// "Issues" is the section root, so it only lights up on an exact match —
		// otherwise it would stay lit on every page beneath it.
		return to === "/app/:slug" ? location.path === target : location.path.startsWith(target);
	});

	return router.Link(
		{
			to,
			params: { slug: activeSlug },
			class: derived([active], (isActive) =>
				cn(
					"flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
					isActive
						? "bg-accent font-medium text-accent-foreground"
						: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
				),
			),
		},
		Icon({ class: "size-3.5" }),
		label,
		badge === undefined
			? null
			: If(
					badge.bind((count) => count > 0),
					Span(
						{
							class:
								"ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground",
						},
						badge.bind((count) => (count > 99 ? "99+" : `${count}`)),
					),
				),
	);
}

function UserMenu(data: Readable<ShellData>) {
	return DropdownMenu(
		DropdownMenuTrigger(
			{ variant: "ghost", class: "h-9 w-full justify-start gap-2 px-2 hover:bg-accent" },
			UserAvatar(data.get().user),
			Span(
				{ class: "truncate text-[13px]" },
				data.bind((shell) => shell.user.name),
			),
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", side: "top" },
			DropdownMenuGroup(
				DropdownMenuGroupHeading(data.bind((shell) => shell.user.email)),
				DropdownMenuItem(
					{ onSelect: () => mode.toggleMode() },
					SunMoon({ class: "size-3.5" }),
					"Toggle theme",
				),
			),
			DropdownMenuSeparator(),
			DropdownMenuItem(
				{
					onSelect: async () => {
						await authClient.signOut();
						window.location.assign("/login");
					},
				},
				LogOut({ class: "size-3.5" }),
				"Sign out",
			),
		),
	);
}
