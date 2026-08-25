import {
	A,
	Button as ButtonElement,
	context,
	derived,
	Div,
	If,
	ImplementDocument,
	ImplementEffect,
	Li,
	mediaQuery,
	signal,
	Span,
	Ul,
	type Child,
	type ElementProps,
	type Mountable,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { PanelLeftIcon } from "@implementjs/lucide";
import {
	createComponent,
	Tooltip as TooltipPrimitive,
	TooltipTrigger as TooltipTriggerPrimitive,
} from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { Input } from "./input";
import { Separator } from "./separator";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";
import { Skeleton } from "./skeleton";
import { TooltipContent } from "./tooltip";
import { cn } from "@/lib/utils";

/**
 * A collapsible application sidebar. `SidebarProvider` owns the open state and
 * hands it to every part through context, so the trigger, the rail, and the
 * inset all stay in step without being wired to each other.
 */

/**
 * The widths are CSS variables with these as their built-in fallbacks, so the
 * sidebar has a size before you have written any CSS — and overriding is a
 * `:root` rule or a class, not a prop:
 * `SidebarProvider({ class: "[--sidebar-width:20rem]" }, ...)`.
 */
export const SIDEBAR_WIDTH = "var(--sidebar-width, 16rem)";
export const SIDEBAR_WIDTH_ICON = "var(--sidebar-width-icon, 3rem)";
export const SIDEBAR_WIDTH_MOBILE = "var(--sidebar-width-mobile, 18rem)";
export const SIDEBAR_KEYBOARD_SHORTCUT = "b";

/** Below this the sidebar becomes an off-canvas drawer. */
const MOBILE_QUERY = "(max-width: 767px)";

export type SidebarStore = {
	/** Open on desktop. Pass your own signal to `SidebarProvider` to control or persist it. */
	open: Signal<boolean>;
	/** Open on mobile, where the sidebar is a drawer. Reset whenever the viewport crosses over. */
	openMobile: Signal<boolean>;
	isMobile: Readable<boolean>;
	/** `"expanded"` or `"collapsed"`, which is what the parts style against. */
	state: Readable<"expanded" | "collapsed">;
	/** Toggles whichever of the two open states currently applies. */
	toggle: () => void;
};

export const SidebarContext = context<SidebarStore>();

/** Render with the nearest sidebar's state — the parts' own escape hatch. */
export function useSidebar(render: (sidebar: SidebarStore) => Child): Mountable {
	return SidebarContext.Use(render);
}

export type SidebarProviderProps = ElementProps<"div"> & {
	/** Own the desktop open state from outside; omit for uncontrolled. */
	open?: Signal<boolean>;
	/** Starting state when uncontrolled. */
	defaultOpen?: boolean;
	/** Turn off the ⌘B / Ctrl+B shortcut. */
	keyboardShortcut?: boolean;
};

export const SidebarProvider = createComponent(function SidebarProvider(
	{
		open,
		defaultOpen = true,
		keyboardShortcut = true,
		class: className,
		...props
	}: SidebarProviderProps,
	...children: Child[]
) {
	const openSignal = open ?? signal(defaultOpen);
	const openMobile = signal(false);
	// SSR has no viewport to measure, and the desktop tree is the one worth
	// prerendering; `mediaQuery` holds that answer through hydration and
	// corrects it straight after.
	const isMobile = mediaQuery(MOBILE_QUERY);
	const state = derived([openSignal], (value) => (value ? "expanded" : "collapsed"));

	const toggle = () => {
		if (isMobile.get()) openMobile.update((value) => !value);
		else openSignal.update((value) => !value);
	};

	const store: SidebarStore = { open: openSignal, openMobile, isMobile, state, toggle };

	return SidebarContext.Provide(store).To(
		// a drawer left open on a phone must not linger once the layout goes
		// back to a docked sidebar
		ImplementEffect([isMobile], (mobile) => {
			if (!mobile) openMobile.set(false);
		}),
		...(keyboardShortcut
			? [
					ImplementDocument({
						onKeydown(event) {
							if (event.key !== SIDEBAR_KEYBOARD_SHORTCUT) return;
							if (!event.metaKey && !event.ctrlKey) return;
							event.preventDefault();
							toggle();
						},
					}),
				]
			: []),
		Div(
			{
				...props,
				"data-slot": "sidebar-wrapper",
				class: cn(
					"group/sidebar-wrapper flex min-h-svh w-full",
					"has-data-[variant=inset]:bg-sidebar",
					className,
				),
			},
			...children,
		),
	);
});

export type SidebarSide = "left" | "right";
export type SidebarVariant = "sidebar" | "floating" | "inset";
export type SidebarCollapsible = "offcanvas" | "icon" | "none";

export type SidebarProps = ElementProps<"div"> & {
	side?: SidebarSide;
	variant?: SidebarVariant;
	collapsible?: SidebarCollapsible;
};

export const Sidebar = createComponent(function Sidebar(
	{
		side = "left",
		variant = "sidebar",
		collapsible = "offcanvas",
		class: className,
		...props
	}: SidebarProps,
	...children: Child[]
) {
	// A sidebar that never collapses needs none of the machinery below.
	if (collapsible === "none") {
		return Div(
			{
				...props,
				"data-slot": "sidebar",
				class: cn(
					"flex h-full w-[var(--sidebar-width,16rem)] flex-col bg-sidebar text-sidebar-foreground",
					className,
				),
			},
			...children,
		);
	}

	return SidebarContext.Use((sidebar) =>
		If(sidebar.isMobile)
			.Then(
				Drawer(
					{ open: sidebar.openMobile, direction: side },
					DrawerContent(
						{
							// no grab bar: a bar floating over the nav items reads as
							// part of the menu. The whole panel is the drag surface.
							showHandle: false,
							class:
								"w-[var(--sidebar-width-mobile,18rem)] max-w-[85vw] bg-sidebar p-0 text-sidebar-foreground",
							"data-slot": "sidebar",
							"data-mobile": "true",
						},
						// the drawer is a dialog, and a dialog needs a name
						DrawerTitle({ class: "sr-only" }, "Sidebar"),
						DrawerDescription({ class: "sr-only" }, "Displays the mobile sidebar."),
						Div({ class: "flex h-full w-full flex-col" }, ...children),
					),
				),
			)
			.Else(
				Div(
					{
						class: "group peer hidden text-sidebar-foreground md:block",
						"data-slot": "sidebar",
						"data-state": sidebar.state,
						"data-collapsible": derived([sidebar.state], (state) =>
							state === "collapsed" ? collapsible : "",
						),
						"data-variant": variant,
						"data-side": side,
					},
					// The gap element reserves the space the fixed panel occupies,
					// so the page content beside it reflows instead of sitting
					// underneath. Two elements, one width, kept in step by CSS.
					Div({
						"data-slot": "sidebar-gap",
						class: cn(
							"relative w-[var(--sidebar-width,16rem)] bg-transparent transition-[width] duration-200 ease-linear motion-reduce:transition-none",
							"group-data-[collapsible=offcanvas]:w-0",
							"group-data-[side=right]:rotate-180",
							variant === "floating" || variant === "inset"
								? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon,3rem)+(--spacing(4)))]"
								: "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon,3rem)]",
						),
					}),
					Div(
						{
							...props,
							"data-slot": "sidebar-container",
							class: cn(
								"fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width,16rem)] transition-[left,right,width] duration-200 ease-linear md:flex motion-reduce:transition-none",
								side === "left"
									? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width,16rem)*-1)]"
									: "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width,16rem)*-1)]",
								variant === "floating" || variant === "inset"
									? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon,3rem)+(--spacing(4))+2px)]"
									: [
											"group-data-[collapsible=icon]:w-[var(--sidebar-width-icon,3rem)]",
											side === "left"
												? "border-r border-sidebar-border"
												: "border-l border-sidebar-border",
										].join(" "),
								className,
							),
						},
						Div(
							{
								"data-sidebar": "sidebar",
								"data-slot": "sidebar-inner",
								class: cn(
									"flex h-full w-full flex-col bg-sidebar",
									"group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm",
								),
							},
							...children,
						),
					),
				),
			),
	);
});

export type SidebarTriggerProps = ElementProps<"button"> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};

export const SidebarTrigger = createComponent(function SidebarTrigger(
	{
		class: className,
		variant = "ghost",
		size = "icon-sm",
		type = "button",
		...props
	}: SidebarTriggerProps,
	...children: Child[]
) {
	return SidebarContext.Use((sidebar) =>
		ButtonElement(
			{
				type,
				"aria-label": "Toggle sidebar",
				...props,
				"data-slot": "sidebar-trigger",
				class: cn(buttonVariants({ variant, size }), className),
				onClick: () => sidebar.toggle(),
			},
			...(children.length > 0 ? children : [PanelLeftIcon({ "aria-hidden": true })]),
		),
	);
});

export type SidebarRailProps = ElementProps<"button">;

/** The hit target along the sidebar's inner edge — drag-free, click to toggle. */
export const SidebarRail = createComponent(function SidebarRail({
	class: className,
	...props
}: SidebarRailProps) {
	return SidebarContext.Use((sidebar) =>
		ButtonElement({
			type: "button",
			tabIndex: -1,
			"aria-label": "Toggle sidebar",
			title: "Toggle sidebar",
			...props,
			"data-slot": "sidebar-rail",
			"data-sidebar": "rail",
			class: cn(
				"absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear sm:flex",
				"after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border",
				"in-data-[side=left]:-right-4 in-data-[side=right]:left-0",
				"group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar",
				className,
			),
			onClick: () => sidebar.toggle(),
		}),
	);
});

export type SidebarInsetProps = ElementProps<"div">;

/** The page beside the sidebar. `inset` variant floats it as a rounded card. */
export const SidebarInset = createComponent(function SidebarInset(
	{ class: className, ...props }: SidebarInsetProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-inset",
			class: cn(
				"relative flex w-full flex-1 flex-col bg-background",
				"md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm",
				"md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
				className,
			),
		},
		...children,
	);
});

export type SidebarInputProps = ElementProps<"input">;

export const SidebarInput = createComponent(function SidebarInput({
	class: className,
	...props
}: SidebarInputProps) {
	return Input({
		...props,
		"data-slot": "sidebar-input",
		class: cn("h-8 w-full shadow-none", className),
	});
});

export type SidebarSectionProps = ElementProps<"div">;

export const SidebarHeader = createComponent(function SidebarHeader(
	{ class: className, ...props }: SidebarSectionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-header",
			"data-sidebar": "header",
			class: cn("flex flex-col gap-2 p-2", className),
		},
		...children,
	);
});

export const SidebarFooter = createComponent(function SidebarFooter(
	{ class: className, ...props }: SidebarSectionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-footer",
			"data-sidebar": "footer",
			class: cn("flex flex-col gap-2 p-2", className),
		},
		...children,
	);
});

export type SidebarSeparatorProps = ElementProps<"div">;

export const SidebarSeparator = createComponent(function SidebarSeparator({
	class: className,
	...props
}: SidebarSeparatorProps) {
	return Separator({
		...props,
		"data-slot": "sidebar-separator",
		"data-sidebar": "separator",
		class: cn("mx-2 w-auto bg-sidebar-border", className),
	});
});

/** The scrolling middle. Collapsed to icons it stops scrolling sideways. */
export const SidebarContent = createComponent(function SidebarContent(
	{ class: className, ...props }: SidebarSectionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-content",
			"data-sidebar": "content",
			class: cn(
				"flex min-h-0 flex-1 flex-col gap-2 overflow-auto",
				"group-data-[collapsible=icon]:overflow-hidden",
				className,
			),
		},
		...children,
	);
});

export const SidebarGroup = createComponent(function SidebarGroup(
	{ class: className, ...props }: SidebarSectionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-group",
			"data-sidebar": "group",
			class: cn("relative flex w-full min-w-0 flex-col p-2", className),
		},
		...children,
	);
});

export type SidebarGroupLabelProps = ElementProps<"div">;

export const SidebarGroupLabel = createComponent(function SidebarGroupLabel(
	{ class: className, ...props }: SidebarGroupLabelProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-group-label",
			"data-sidebar": "group-label",
			class: cn(
				"flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none",
				"transition-[margin,opacity] duration-200 ease-linear motion-reduce:transition-none",
				"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				"[&>svg]:size-4 [&>svg]:shrink-0",
				"group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
				className,
			),
		},
		...children,
	);
});

export type SidebarGroupActionProps = ElementProps<"button">;

export const SidebarGroupAction = createComponent(function SidebarGroupAction(
	{ class: className, type = "button", ...props }: SidebarGroupActionProps,
	...children: Child[]
) {
	return ButtonElement(
		{
			type,
			...props,
			"data-slot": "sidebar-group-action",
			"data-sidebar": "group-action",
			class: cn(
				"absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none transition-transform",
				"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				"[&>svg]:size-4 [&>svg]:shrink-0",
				// widen the hit target on touch, where 20px is not enough
				"after:absolute after:-inset-2 md:after:hidden",
				"group-data-[collapsible=icon]:hidden",
				className,
			),
		},
		...children,
	);
});

export const SidebarGroupContent = createComponent(function SidebarGroupContent(
	{ class: className, ...props }: SidebarSectionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-group-content",
			"data-sidebar": "group-content",
			class: cn("w-full text-sm", className),
		},
		...children,
	);
});

export type SidebarMenuProps = ElementProps<"ul">;
export type SidebarMenuItemProps = ElementProps<"li">;

export const SidebarMenu = createComponent(function SidebarMenu(
	{ class: className, ...props }: SidebarMenuProps,
	...children: Child[]
) {
	return Ul(
		{
			...props,
			"data-slot": "sidebar-menu",
			"data-sidebar": "menu",
			class: cn("flex w-full min-w-0 flex-col gap-1", className),
		},
		...children,
	);
});

export const SidebarMenuItem = createComponent(function SidebarMenuItem(
	{ class: className, ...props }: SidebarMenuItemProps,
	...children: Child[]
) {
	return Li(
		{
			...props,
			"data-slot": "sidebar-menu-item",
			"data-sidebar": "menu-item",
			class: cn("group/menu-item relative", className),
		},
		...children,
	);
});

export const sidebarMenuButtonVariants = tv({
	base: [
		"peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-[width,height,padding]",
		"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
		"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
		"active:bg-sidebar-accent active:text-sidebar-accent-foreground",
		"disabled:pointer-events-none disabled:opacity-50",
		"aria-disabled:pointer-events-none aria-disabled:opacity-50",
		"data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
		"data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground",
		"group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!",
		"[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
	],
	variants: {
		variant: {
			default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
			outline:
				"bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
		},
		size: {
			default: "h-8 text-sm",
			sm: "h-7 text-xs",
			lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
		},
	},
	defaultVariants: { variant: "default", size: "default" },
});

export type SidebarMenuButtonVariant = VariantProps<typeof sidebarMenuButtonVariants>["variant"];
export type SidebarMenuButtonSize = VariantProps<typeof sidebarMenuButtonVariants>["size"];

type MenuButtonStyleProps = VariantProps<typeof sidebarMenuButtonVariants> & {
	/** Marks the item as the current one — `data-active`, which the styles read. */
	isActive?: boolean;
};

/**
 * `id` and `disabled` are narrower here than on a bare button: with `tooltip`
 * set the row *is* the tooltip trigger, and that primitive takes a plain
 * string id and a `Signal<boolean> | boolean` rather than any bindable.
 */
export type SidebarMenuButtonProps = Omit<ElementProps<"button">, "id" | "disabled"> &
	MenuButtonStyleProps & {
		id?: string;
		disabled?: Signal<boolean> | boolean;
		/** Label shown as a tooltip while the sidebar is collapsed to icons. */
		tooltip?: string;
	};

/**
 * One row of the menu, as a button. `tooltip` is what makes an icon-collapsed
 * sidebar usable: the label reappears on hover, and only while collapsed.
 *
 * For a row that navigates, use {@link SidebarMenuLink} — the tooltip
 * primitive's trigger is a button, so the two cannot be the same component.
 */
export const SidebarMenuButton = createComponent(function SidebarMenuButton(
	{
		class: className,
		variant = "default",
		size = "default",
		isActive = false,
		tooltip,
		type = "button",
		...props
	}: SidebarMenuButtonProps,
	...children: Child[]
) {
	const buttonClass = [sidebarMenuButtonVariants({ variant, size }), className];

	if (tooltip == null) {
		return ButtonElement(
			{
				type,
				...props,
				"data-slot": "sidebar-menu-button",
				"data-sidebar": "menu-button",
				"data-size": size,
				"data-active": isActive,
				class: buttonClass,
			},
			...children,
		);
	}

	return SidebarContext.Use((sidebar) =>
		TooltipPrimitive(
			TooltipTriggerPrimitive(
				{
					...props,
					"data-slot": "sidebar-menu-button",
					"data-sidebar": "menu-button",
					"data-size": size,
					"data-active": isActive,
					class: buttonClass,
				},
				...children,
			),
			// an expanded sidebar already shows the label; the tooltip would
			// only repeat it, so it is rendered but never shown
			If([sidebar.state, sidebar.isMobile], (state, mobile) => state === "collapsed" && !mobile)
				.Then(TooltipContent({ side: "right", align: "center" }, tooltip))
				.Else(Span()),
		),
	);
});

export type SidebarMenuLinkProps = ElementProps<"a"> & MenuButtonStyleProps;

/** One row of the menu, as a link. Same styling as {@link SidebarMenuButton}. */
export const SidebarMenuLink = createComponent(function SidebarMenuLink(
	{
		class: className,
		variant = "default",
		size = "default",
		isActive = false,
		...props
	}: SidebarMenuLinkProps,
	...children: Child[]
) {
	return A(
		{
			...props,
			"data-slot": "sidebar-menu-button",
			"data-sidebar": "menu-button",
			"data-size": size,
			"data-active": isActive,
			class: cn(sidebarMenuButtonVariants({ variant, size }), className),
		},
		...children,
	);
});

export type SidebarMenuActionProps = ElementProps<"button"> & {
	/** Reveal it only on hover or focus, instead of always. */
	showOnHover?: boolean;
};

export const SidebarMenuAction = createComponent(function SidebarMenuAction(
	{ class: className, showOnHover = false, type = "button", ...props }: SidebarMenuActionProps,
	...children: Child[]
) {
	return ButtonElement(
		{
			type,
			...props,
			"data-slot": "sidebar-menu-action",
			"data-sidebar": "menu-action",
			class: cn(
				"absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none transition-transform",
				"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				"peer-hover/menu-button:text-sidebar-accent-foreground",
				"[&>svg]:size-4 [&>svg]:shrink-0",
				"after:absolute after:-inset-2 md:after:hidden",
				"peer-data-[size=sm]/menu-button:top-1",
				"peer-data-[size=default]/menu-button:top-1.5",
				"peer-data-[size=lg]/menu-button:top-2.5",
				"group-data-[collapsible=icon]:hidden",
				showOnHover &&
					"data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 md:opacity-0",
				className,
			),
		},
		...children,
	);
});

export type SidebarMenuBadgeProps = ElementProps<"div">;

export const SidebarMenuBadge = createComponent(function SidebarMenuBadge(
	{ class: className, ...props }: SidebarMenuBadgeProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-menu-badge",
			"data-sidebar": "menu-badge",
			class: cn(
				"pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground select-none",
				"peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
				"peer-data-[size=sm]/menu-button:top-1",
				"peer-data-[size=default]/menu-button:top-1.5",
				"peer-data-[size=lg]/menu-button:top-2.5",
				"group-data-[collapsible=icon]:hidden",
				className,
			),
		},
		...children,
	);
});

export type SidebarMenuSkeletonProps = ElementProps<"div"> & {
	/** Also draw a square where the row's icon will be. */
	showIcon?: boolean;
	/** Text width for the row, so a list of them does not look ruled. */
	width?: string;
};

export const SidebarMenuSkeleton = createComponent(function SidebarMenuSkeleton({
	class: className,
	showIcon = false,
	width = "70%",
	...props
}: SidebarMenuSkeletonProps) {
	return Div(
		{
			...props,
			"data-slot": "sidebar-menu-skeleton",
			"data-sidebar": "menu-skeleton",
			class: cn("flex h-8 items-center gap-2 rounded-md px-2", className),
		},
		showIcon ? Skeleton({ class: "size-4 rounded-md" }) : null,
		Skeleton({
			class: "h-4 max-w-(--skeleton-width) flex-1",
			style: { "--skeleton-width": width },
		}),
	);
});

export type SidebarMenuSubProps = ElementProps<"ul">;
export type SidebarMenuSubItemProps = ElementProps<"li">;

export const SidebarMenuSub = createComponent(function SidebarMenuSub(
	{ class: className, ...props }: SidebarMenuSubProps,
	...children: Child[]
) {
	return Ul(
		{
			...props,
			"data-slot": "sidebar-menu-sub",
			"data-sidebar": "menu-sub",
			class: cn(
				"mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
				"group-data-[collapsible=icon]:hidden",
				className,
			),
		},
		...children,
	);
});

export const SidebarMenuSubItem = createComponent(function SidebarMenuSubItem(
	{ class: className, ...props }: SidebarMenuSubItemProps,
	...children: Child[]
) {
	return Li(
		{
			...props,
			"data-slot": "sidebar-menu-sub-item",
			"data-sidebar": "menu-sub-item",
			class: cn("group/menu-sub-item relative", className),
		},
		...children,
	);
});

type SubButtonStyleProps = { size?: "sm" | "md"; isActive?: boolean };

export type SidebarMenuSubButtonProps = ElementProps<"button"> & SubButtonStyleProps;
export type SidebarMenuSubLinkProps = ElementProps<"a"> & SubButtonStyleProps;

export const SidebarMenuSubButton = createComponent(function SidebarMenuSubButton(
	{
		class: className,
		size = "md",
		isActive = false,
		type = "button",
		...props
	}: SidebarMenuSubButtonProps,
	...children: Child[]
) {
	return ButtonElement(
		{
			type,
			...props,
			"data-slot": "sidebar-menu-sub-button",
			"data-sidebar": "menu-sub-button",
			"data-size": size,
			"data-active": isActive,
			class: cn(
				"flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none",
				"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				"active:bg-sidebar-accent active:text-sidebar-accent-foreground",
				"disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
				"data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
				"data-[size=sm]:text-xs data-[size=md]:text-sm",
				"[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
				"group-data-[collapsible=icon]:hidden",
				className,
			),
		},
		...children,
	);
});

export const SidebarMenuSubLink = createComponent(function SidebarMenuSubLink(
	{ class: className, size = "md", isActive = false, ...props }: SidebarMenuSubLinkProps,
	...children: Child[]
) {
	return A(
		{
			...props,
			"data-slot": "sidebar-menu-sub-button",
			"data-sidebar": "menu-sub-button",
			"data-size": size,
			"data-active": isActive,
			class: cn(
				"flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none",
				"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				"focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				"active:bg-sidebar-accent active:text-sidebar-accent-foreground",
				"disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
				"data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
				"data-[size=sm]:text-xs data-[size=md]:text-sm",
				"[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
				"group-data-[collapsible=icon]:hidden",
				className,
			),
		},
		...children,
	);
});
