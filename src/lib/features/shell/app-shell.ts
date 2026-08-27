import { router } from "$implement/router";
import {
	Aside,
	Div,
	Dynamic,
	ForEach,
	If,
	ImplementDocument,
	ImplementEffect,
	ImplementLifecycle,
	Main,
	Span,
	derived,
	mediaQuery,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import {
	ChevronDown,
	CircleUser,
	Inbox as InboxIcon,
	LayoutList,
	LayoutTemplate,
	Menu,
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
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/lib/components/ui/drawer";
import { UserAvatar } from "@/lib/components/glyphs";
import { WorkspaceAvatar } from "@/lib/components/workspace-avatar";
import type { IssueTemplate, Team, Workspace } from "@/lib/domain/schemas";
import { mode } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { CommandPalette, openCommandPalette } from "./command-palette";
import {
	CreateIssueDialog,
	openCreateIssue,
	openCreateIssueFromTemplate,
} from "@/lib/features/issues/create-issue-dialog";
import { seedUnreadCount, unreadCount } from "@/lib/features/inbox/unread";
import { TeamIcon } from "@/lib/features/teams/team-icon";

export interface ShellData {
	user: App.SessionUser;
	workspaces: Workspace[];
	unread: number;
	workspace: Workspace;
	teams: Team[];
}

/** How often the inbox badge re-checks. Cheap query, and 15s reads as live. */
const POLL_MS = 15_000;

/** Above this the sidebar is docked; below it lives in a drawer. */
const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * The badge is the one number on screen that must not go stale, so it polls
 * rather than waiting for the next navigation to reseed it. It writes into the
 * shared store rather than a local signal — see `inbox/unread.ts` — which is
 * what leaves it with nothing of the shell's to capture.
 */
async function pollUnread(): Promise<void> {
	const { data: result, error } = await api.GET("/api/v1/notifications/unread");
	if (error === undefined) seedUnreadCount(result.count);
}

export function AppShell(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
	url: Readable<{ path: string }>,
	children: Child,
) {
	// The count itself lives in `inbox/unread.ts`, because the shell is not the
	// only thing that moves it: reading a notification in the inbox has to drop
	// the badge at once rather than at the next poll. The shell owns the two
	// authoritative sources — the layout load and the poll — and nothing else
	// writes a total.
	seedUnreadCount(data.get().unread);
	const unread = unreadCount;

	const mobileNavOpen = signal(false);
	const isDesktop = mediaQuery(DESKTOP_QUERY);

	return Div(
		{ class: "flex h-dvh overflow-clip" },

		// A client navigation reseeds the layout's load rather than remounting the
		// shell, so a fresh count arriving that way has to land in the store too.
		ImplementEffect([data], (shell) => seedUnreadCount(shell.unread), { immediate: false }),

		ImplementLifecycle({
			onMount: () => {
				const timer = setInterval(() => void pollUnread(), POLL_MS);
				// A tab that comes back to the foreground should catch up at once
				// instead of waiting out the rest of the interval.
				const onVisible = () => {
					if (document.visibilityState === "visible") void pollUnread();
				};
				document.addEventListener("visibilitychange", onVisible);

				// Sidebar targets are lazy route chunks. Warm them so a click cannot
				// render a page whose module has not loaded yet.
				const slug = activeSlug.get();
				void preloadRoute(`/app/${slug}/inbox`);
				void preloadRoute(`/app/${slug}/my-issues`);
				void preloadRoute(`/app/${slug}/feedback`);
				void preloadRoute(`/app/${slug}/settings`);

				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			},
		}),
		// a drawer left open on a phone must not linger once the layout goes
		// back to a docked sidebar — and a navigation is a destination reached,
		// so the drawer's job is done
		ImplementEffect([isDesktop], (desktop) => {
			if (desktop) mobileNavOpen.set(false);
		}),
		ImplementEffect([url], () => mobileNavOpen.set(false), { immediate: false }),

		Sidebar(data, activeSlug, url, unread),
		MobileSidebar(data, activeSlug, url, unread, mobileNavOpen),
		Main(
			{ class: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" },
			MobileHeader(data, activeSlug, url, mobileNavOpen),
			children,
		),

		ImplementDocument({
			onKeydown: (event) => {
				if (isTyping(event)) return;
				if (event.metaKey || event.ctrlKey || event.altKey) return;
				const key = event.key.toLowerCase();
				if (key === "c") {
					event.preventDefault();
					openCreateIssue(activeSlug.get(), teamKeyFromPath(url.get().path));
					return;
				}
				// The list header lost its search box; `/` still means "find",
				// it just lands in the palette now.
				if (key === "/") {
					event.preventDefault();
					openCommandPalette(activeSlug.get());
				}
			},
		}),

		// Mounted once for the whole app: both are opened imperatively from
		// hotkeys, the sidebar and the palette itself.
		CreateIssueDialog(data.bind((shell) => shell.workspaces)),
		CommandPalette(activeSlug),
	);
}

/**
 * Everything inside the sidebar. A factory rather than a shared node, because
 * it is mounted twice — in the docked aside and in the mobile drawer — and a
 * mountable can only live in one place.
 */
function SidebarBody(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
	url: Readable<{ path: string }>,
	unread: Readable<number>,
): Child[] {
	return [
		WorkspaceSwitcher(data, activeSlug),

		NewIssueControl(activeSlug, url),

		Div(
			{ class: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" },
			// What is waiting for you, then what is yours, then everything —
			// Linear's ordering, narrowest scope first.
			NavItem(url, activeSlug, "/app/:slug/inbox", InboxIcon, "Inbox", unread),
			NavItem(url, activeSlug, "/app/:slug/my-issues", CircleUser, "My Issues"),
			NavItem(url, activeSlug, "/app/:slug", LayoutList, "Issues"),
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
	];
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
				"hidden h-full min-h-0 w-[232px] shrink-0 flex-col gap-1 overflow-clip border-r border-sidebar-border bg-sidebar px-3 py-3 md:flex",
		},
		...SidebarBody(data, activeSlug, url, unread),
	);
}

/** The same sidebar as an off-canvas drawer, for viewports without the room. */
function MobileSidebar(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
	url: Readable<{ path: string }>,
	unread: Readable<number>,
	open: Signal<boolean>,
) {
	return Drawer(
		{ open, direction: "left" },
		DrawerContent(
			{
				// no grab bar: a bar floating over the nav items reads as part of
				// the menu. The whole panel is the drag surface.
				showHandle: false,
				class: "w-72 max-w-[85vw] bg-sidebar p-0 text-sidebar-foreground",
			},
			// the drawer is a dialog, and a dialog needs a name
			DrawerTitle({ class: "sr-only" }, "Navigation"),
			DrawerDescription({ class: "sr-only" }, "Displays the workspace navigation."),
			Div(
				{ class: "flex h-full min-h-0 w-full flex-col gap-1 px-3 py-3" },
				...SidebarBody(data, activeSlug, url, unread),
			),
		),
	);
}

/** The bar that stands in for the sidebar on small screens. */
function MobileHeader(
	data: Readable<ShellData>,
	activeSlug: Readable<string>,
	url: Readable<{ path: string }>,
	open: Signal<boolean>,
) {
	const current = derived([data, activeSlug], (shell, slug) =>
		shell.workspaces.find((workspace) => workspace.slug === slug),
	);

	return Div(
		{ class: "flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden" },
		Button(
			{
				variant: "ghost",
				size: "icon-sm",
				"aria-label": "Open navigation",
				onClick: () => open.set(true),
			},
			Menu({ class: "size-4" }),
		),
		WorkspaceTile(current),
		Span(
			{ class: "min-w-0 truncate text-[13px] font-medium" },
			current.bind((workspace) => workspace?.name ?? "No workspace"),
		),
		Button(
			{
				variant: "ghost",
				size: "icon-sm",
				class: "ml-auto",
				"aria-label": "New issue",
				onClick: () => openCreateIssue(activeSlug.get(), teamKeyFromPath(url.get().path)),
			},
			Plus({ class: "size-4" }),
		),
	);
}

/** `/app/acme/team/ENG/…` → `ENG`, and undefined anywhere else. */
function teamKeyFromPath(path: string): string | undefined {
	return /\/app\/[^/]+\/team\/([^/?#]+)/.exec(path)?.[1]?.toUpperCase();
}

/**
 * New issue, split: the button opens a blank composer, the chevron opens one of
 * the workspace's templates. Templates are fetched here rather than seeded by
 * the layout so adding one in settings shows up without a reload.
 */
function NewIssueControl(activeSlug: Readable<string>, url: Readable<{ path: string }>) {
	const templates = signal<IssueTemplate[]>([]);

	const load = async () => {
		const slug = activeSlug.get();
		if (slug === "") return;
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/templates", {
			params: { slug },
		});
		if (error === undefined) templates.set(data);
	};

	return Div(
		{ class: "mt-2 mb-2 flex w-full items-stretch" },
		ImplementLifecycle({ onMount: () => void load() }),
		// Switching workspaces keeps this control mounted, so the list has to
		// follow the slug rather than only load once.
		ImplementEffect([activeSlug], () => void load(), { immediate: false }),

		Button(
			{
				variant: "secondary",
				size: "sm",
				class: "min-w-0 flex-1 justify-start gap-2 rounded-r-none text-[13px]",
				onClick: () => openCreateIssue(activeSlug.get(), teamKeyFromPath(url.get().path)),
			},
			Plus({ class: "size-3.5" }),
			"New issue",
			Span({ class: "ml-auto text-[11px] text-muted-foreground" }, "C"),
		),

		DropdownMenu(
			{ preventScroll: false },
			DropdownMenuTrigger(
				{
					variant: "secondary",
					size: "sm",
					class: "shrink-0 rounded-l-none border-l border-background/60 px-1.5",
					title: "New issue from a template",
					"aria-label": "New issue from a template",
				},
				ChevronDown({ class: "size-3.5" }),
			),
			DropdownMenuContent(
				{ class: "w-60", align: "start" },
				DropdownMenuGroup(
					DropdownMenuGroupHeading("Templates"),
					If(
						templates.bind((list) => list.length === 0),
						Div({ class: "px-2 py-1.5 text-[12px] text-muted-foreground" }, "No templates yet."),
					),
					ForEach(
						templates,
						(template) => template.id,
						(template) =>
							DropdownMenuItem(
								{
									onSelect: () =>
										openCreateIssueFromTemplate(
											activeSlug.get(),
											template.get(),
											teamKeyFromPath(url.get().path),
										),
								},
								LayoutTemplate({ class: "size-3.5 shrink-0" }),
								Span({ class: "truncate" }, template.bind("name")),
							),
					),
				),
				DropdownMenuSeparator(),
				DropdownMenuItem(
					{ onSelect: () => router.navigate("/app/:slug/settings", { slug: activeSlug.get() }) },
					SettingsIcon({ class: "size-3.5" }),
					"Manage templates",
				),
			),
		),
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
 * The workspace's picture, or the avatar generated from its slug.
 *
 * `Dynamic` rather than `If`, because the two branches are different elements
 * and swapping between them is exactly what `Dynamic` is for.
 */
function WorkspaceTile(workspace: Readable<Workspace | undefined>) {
	return Dynamic([workspace], (value) => WorkspaceAvatar(value));
}

type NavPath =
	| "/app/:slug"
	| "/app/:slug/inbox"
	| "/app/:slug/my-issues"
	| "/app/:slug/feedback"
	| "/app/:slug/settings";

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
 * Teams, each linking to its own issue list.
 *
 * The row is a tile and a name, the way Linear reads: a coloured glyph is
 * something you find by shape at a glance, where three monospaced letters make
 * every row look the same until you read it. The key is what issues are
 * prefixed with rather than what the team is called, so it moves to the row's
 * `title` — still there when you need to know it, out of the scanning path when
 * you do not.
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
						title: team.bind((value) => `${value.name} (${value.key})`),
						class: derived([active], (isActive) =>
							cn(
								"flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
								isActive
									? "bg-accent font-medium text-accent-foreground"
									: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
							),
						),
					},
					// `TeamIcon` takes plain values, so the tile is swapped rather than
					// updated when the team behind the row changes — a rename or a newly
					// picked icon repaints it without the row moving.
					Dynamic([team], (value) => TeamIcon(value, "size-4")),
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
