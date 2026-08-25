import { router } from "$implement/router";
import {
	Aside,
	Div,
	Dynamic,
	ForEach,
	If,
	Img,
	ImplementDocument,
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
	MessageSquareQuote,
	LogOut,
	Plus,
	Settings as SettingsIcon,
	UserCog,
	SunMoon,
} from "@implementjs/lucide";
import { preloadRoute } from "@implementjs/kit/runtime";
import { api } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth";
import { isTyping } from "@/lib/client/is-typing";
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
import type { Team, Workspace } from "@/lib/domain/schemas";
import { mode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { CommandPalette, openCommandPalette } from "./command-palette";
import { CreateIssueDialog, openCreateIssue } from "@/lib/features/issues/create-issue-dialog";

export interface ShellData {
	user: App.SessionUser;
	workspaces: Workspace[];
	unread: number;
	workspace: Workspace;
	teams: Team[];
}

/** How often the inbox badge re-checks. Cheap query, and 15s reads as live. */
const POLL_MS = 15_000;

export function AppShell(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
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

	return Div(
		{ class: "flex h-dvh overflow-clip" },
		ImplementLifecycle({
			onMount: () => {
				const timer = setInterval(() => void poll(), POLL_MS);
				// A tab that comes back to the foreground should catch up at once
				// instead of waiting out the rest of the interval.
				const onVisible = () => {
					if (document.visibilityState === "visible") void poll();
				};
				document.addEventListener("visibilitychange", onVisible);

				// Sidebar targets are lazy route chunks. Warm them so a click cannot
				// render a page whose module has not loaded yet.
				const slug = activeSlug.get();
				void preloadRoute(`/app/${slug}/inbox`);
				void preloadRoute(`/app/${slug}/feedback`);
				void preloadRoute(`/app/${slug}/settings`);

				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			},
		}),
		Sidebar(data, activeSlug, url, unread),
		Main({ class: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" }, children),

		ImplementDocument({
			onKeydown: (event) => {
				if (isTyping(event.target)) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				if (event.key.toLowerCase() !== "c") return;
				event.preventDefault();
				const match = /\/app\/[^/]+\/team\/([^/?#]+)/.exec(url.get().path);
				openCreateIssue(activeSlug.get(), match?.[1]?.toUpperCase());
			},
		}),

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
				"flex h-full min-h-0 w-[232px] shrink-0 flex-col gap-1 overflow-clip border-r border-sidebar-border bg-sidebar px-3 py-3",
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

		Div(
			{ class: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" },
			NavItem(url, activeSlug, "/app/:slug/inbox", InboxIcon, "Inbox", unread),
			NavItem(url, activeSlug, "/app/:slug", LayoutList, "All issues"),
			NavItem(url, activeSlug, "/app/:slug/feedback", MessageSquareQuote, "User feedback"),
			NavItem(url, activeSlug, "/app/:slug/settings", SettingsIcon, "Settings"),
			TeamNav(data, activeSlug, url),
		),

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
		{ preventScroll: false },
		DropdownMenuTrigger(
			{
				variant: "ghost",
				class: "h-9 w-full justify-start gap-2 px-2 hover:bg-accent",
			},
			WorkspaceTile(current),
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
							WorkspaceTile(workspace),
							Span({ class: "truncate" }, workspace.bind("name")),
						),
				),
			),
			DropdownMenuSeparator(),
			DropdownMenuItem(
				{ onSelect: () => window.location.assign("/workspaces/new") },
				Plus({ class: "size-3.5" }),
				"Create workspace",
			),
		),
	);
}

/**
 * The workspace's picture, or the initial on a colored tile.
 *
 * `Dynamic` rather than `If`, because the two branches are different elements
 * and swapping between them is exactly what `Dynamic` is for.
 */
function WorkspaceTile(workspace: Readable<Workspace | undefined>) {
	return Dynamic([workspace], (value) =>
		value?.image != null && value.image !== ""
			? Img({
					src: value.image,
					alt: "",
					class: "size-5 shrink-0 rounded-[5px] object-cover",
				})
			: Div(
					{ class: "flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-primary" },
					Span(
						{ class: "text-[10px] font-bold text-primary-foreground" },
						(value?.name ?? "?").slice(0, 1).toUpperCase(),
					),
				),
	);
}

type NavPath = "/app/:slug" | "/app/:slug/inbox" | "/app/:slug/feedback" | "/app/:slug/settings";

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
			onPointerenter: () => {
				void preloadRoute(router.href(to, { slug: activeSlug.get() }));
			},
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
		{ preventScroll: false },
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
					{
						onSelect: () => window.location.assign(`/app/${data.get().workspace.slug}/account`),
					},
					UserCog({ class: "size-3.5" }),
					"Account settings",
				),
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

/**
 * Teams, each linking to its own issue list. A team's key is the prefix its
 * issues carry, so it is shown beside the name rather than hidden.
 */
function TeamNav(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
	url: Readable<{ path: string }>,
) {
	return Div(
		{ class: "mt-4 flex flex-col gap-0.5" },
		Div(
			{ class: "px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70" },
			"Teams",
		),
		ForEach(
			data.bind((shell) => shell.teams),
			(team) => team.id,
			(team) => {
				const active = derived([url, activeSlug], (location, slug) =>
					location.path.startsWith(`/app/${slug}/team/${team.get().key}`),
				);
				return router.Link(
					{
						to: "/app/:slug/team/:key",
						params: { slug: activeSlug, key: team.bind("key") },
						class: derived([active], (isActive) =>
							cn(
								"flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
								isActive
									? "bg-accent font-medium text-accent-foreground"
									: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
							),
						),
					},
					Span(
						{ class: "w-9 shrink-0 font-mono text-[11px] text-muted-foreground" },
						team.bind("key"),
					),
					Span({ class: "truncate" }, team.bind("name")),
					Span(
						{ class: "ml-auto text-[11px] text-muted-foreground/70" },
						team.bind((value) => (value.issueCount === 0 ? "" : `${value.issueCount}`)),
					),
				);
			},
		),
	);
}
