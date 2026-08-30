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
	Check,
	ChevronDown,
	CircleUser,
	Inbox as InboxIcon,
	LayoutList,
	LayoutTemplate,
	Menu,
	MessageSquareQuote,
	LogOut,
	Pencil,
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
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
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
import {
	TemplateDialog,
	openCreateTemplate,
	openEditTemplate,
	templatesChanged,
} from "@/lib/features/issues/template-dialog";
import { seedUnreadCount, unreadCount } from "@/lib/features/inbox/unread";
import { TeamIcon } from "@/lib/features/teams/team-icon";
import { KEY_HINT_CLASS } from "@/lib/components/ui/kbd";

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
					openCommandPalette();
				}
			},
		}),

		// Mounted once for the whole app: both are opened imperatively from
		// hotkeys, the sidebar and the palette itself.
		CreateIssueDialog(
			data.bind((shell) => shell.workspaces),
			// The slug comes off the same load as the teams rather than off the
			// route, so a composer opened mid-navigation cannot pair one
			// workspace's slug with another's teams.
			{
				slug: data.bind((shell) => shell.workspace.slug),
				teams: data.bind((shell) => shell.teams),
			},
		),
		TemplateDialog(),
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
			Span(
				{ class: cn("flex size-3.5 items-center justify-center text-[11px]", KEY_HINT_CLASS) },
				"⌘",
			),
			"Command palette",
			Span({ class: cn("ml-auto text-[11px]", KEY_HINT_CLASS) }, "⌘K"),
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
		MobileWorkspaceSwitcher(data, current),
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

/**
 * The header's workspace switcher, as a drawer up from the bottom edge (ENG-70).
 *
 * The docked sidebar's switcher is a dropdown anchored under a full-width
 * trigger; on a phone that same panel would hang off a 12px-tall header, under
 * the thumb that opened it and as far from it as the screen allows. A drawer
 * comes from the edge the thumb is already at, is as wide as the device, and
 * gets rows big enough to hit — the shape `responsive-menu.ts` reaches for, and
 * the one the sidebar itself takes on this viewport.
 *
 * Its own component rather than a `ResponsiveMenu`, because the list ends in an
 * action ("Create workspace") rather than another option, and a picker whose
 * rows are all `menuitemradio` has nowhere to put one.
 */
function MobileWorkspaceSwitcher(
	data: Readable<ShellData>,
	current: Readable<Workspace | undefined>,
) {
	const open = signal(false);
	const isDesktop = mediaQuery(DESKTOP_QUERY);

	return Div(
		{ class: "contents" },
		// The panel is portaled to the body, so the header going `md:hidden` does
		// not take it with it — one left open has to be closed by hand.
		ImplementEffect([isDesktop], (desktop) => {
			if (desktop) open.set(false);
		}),

		Button(
			{
				variant: "ghost",
				size: "sm",
				class: "-ml-1 min-w-0 flex-1 justify-start gap-2 px-1.5",
				"aria-haspopup": "dialog",
				"aria-label": "Switch workspace",
				onClick: () => open.set(true),
			},
			WorkspaceTile(current),
			Span(
				{ class: "min-w-0 truncate text-[13px] font-medium" },
				current.bind((workspace) => workspace?.name ?? "No workspace"),
			),
			ChevronDown({ class: "size-3.5 shrink-0 text-muted-foreground" }),
		),

		Drawer(
			{ open },
			DrawerContent(
				DrawerTitle(
					{ class: "px-4 pt-1 pb-2 text-[13px] font-medium text-muted-foreground" },
					"Workspaces",
				),
				DrawerDescription({ class: "sr-only" }, "Switch to another workspace."),
				Div(
					{ role: "menu", class: "flex max-h-[60dvh] flex-col gap-0.5 overflow-y-auto px-2" },
					ForEach(
						data.bind((shell) => shell.workspaces),
						(workspace) => workspace.id,
						(workspace) => {
							const active = current.bind((value) => value?.slug === workspace.get().slug);
							return Button(
								{
									variant: "ghost",
									role: "menuitemradio",
									"aria-checked": active,
									class: "h-11 w-full justify-start gap-2.5 px-3 text-[14px] font-normal",
									onClick: () => {
										open.set(false);
										// Already here: closing is the whole of it, and navigating
										// anyway would throw away where in the workspace you are.
										if (active.get()) return;
										router.navigate("/app/:slug", { slug: workspace.get().slug });
									},
								},
								WorkspaceTile(workspace),
								Span({ class: "flex-1 truncate text-left" }, workspace.bind("name")),
								If(active, Check({ class: "size-4 shrink-0 text-primary" })),
							);
						},
					),
				),
				Div(
					{ class: "mt-1 border-t border-border px-2 pt-1" },
					Button(
						{
							variant: "ghost",
							class: "h-11 w-full justify-start gap-2.5 px-3 text-[14px] font-normal",
							onClick: () => {
								open.set(false);
								window.location.assign("/workspaces/new");
							},
						},
						Plus({ class: "size-4 shrink-0" }),
						"Create workspace",
					),
				),
			),
		),
	);
}

/** `/app/acme/team/ENG/…` → `ENG`, and undefined anywhere else. */
function teamKeyFromPath(path: string): string | undefined {
	return /\/app\/[^/]+\/team\/([^/?#]+)/.exec(path)?.[1]?.toUpperCase();
}

/**
 * New issue, split: the button opens a blank composer, the chevron opens one of
 * the workspace's templates — and is also where templates are made and edited.
 * The list is fetched here rather than seeded by the layout so a template
 * created in the dialog shows up without a reload.
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
		// The dialog is mounted once in the shell and cannot reach into the two
		// copies of this control, so it announces the change and both refetch.
		ImplementEffect([templatesChanged], () => void load(), { immediate: false }),

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
					{ onSelect: () => openCreateTemplate(activeSlug.get()) },
					Plus({ class: "size-3.5" }),
					"New template",
				),
				// Editing hangs off a submenu rather than a control on each row: a
				// row's whole job is "start an issue from this", and a second
				// target inside it is a click you can miss.
				If(
					templates.bind((list) => list.length > 0),
					DropdownMenuSub(
						DropdownMenuSubTrigger({}, Pencil({ class: "size-3.5" }), "Edit template"),
						DropdownMenuSubContent(
							{ class: "w-56" },
							ForEach(
								templates,
								(template) => template.id,
								(template) =>
									DropdownMenuItem(
										{ onSelect: () => openEditTemplate(activeSlug.get(), template.get()) },
										LayoutTemplate({ class: "size-3.5 shrink-0" }),
										Span({ class: "truncate" }, template.bind("name")),
									),
							),
						),
					),
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
