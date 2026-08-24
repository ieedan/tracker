import { Div, Span, type Child, type ComponentProps, type Mountable } from "@implementjs/core";
import { XIcon } from "@implementjs/lucide";
import {
	createComponent,
	Drawer as DrawerPrimitive,
	DrawerClose as DrawerClosePrimitive,
	DrawerContent as DrawerContentPrimitive,
	DrawerCtx,
	DrawerDescription as DrawerDescriptionPrimitive,
	DrawerHandle as DrawerHandlePrimitive,
	DrawerOverlay as DrawerOverlayPrimitive,
	DrawerPortal as DrawerPortalPrimitive,
	DrawerTitle as DrawerTitlePrimitive,
	DrawerTrigger as DrawerTriggerPrimitive,
	type DrawerDirection,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "@/lib/utils";

/**
 * A drawer is a panel you can throw back out. It is the dialog's focus trap,
 * escape and outside dismissal, and aria wiring, with a drag on top: the panel
 * follows the pointer, rubber bands past its open position, and lands on a
 * snap point (or off the screen) according to how fast it was let go.
 *
 * Every part reads `direction` off the root, so the panel, its handle, and the
 * scrim only have to be told which edge to live on once.
 */

/** The motion Vaul uses, and what makes a thrown panel feel like it has weight. */
const EASE = "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

export type DrawerProps = ComponentProps<typeof DrawerPrimitive>;
export type DrawerTriggerProps = ComponentProps<typeof DrawerTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type DrawerOverlayProps = ComponentProps<typeof DrawerOverlayPrimitive>;
export type DrawerContentProps = ComponentProps<typeof DrawerContentPrimitive> & {
	/** Show the grab bar at the dragging edge. Defaults to true. */
	showHandle?: boolean;
	/** Show a close button in the corner. Defaults to false — the handle is the affordance. */
	showCloseButton?: boolean;
	/** Props for the overlay the content renders behind itself. */
	overlay?: DrawerOverlayProps;
};
export type DrawerHandleProps = ComponentProps<typeof DrawerHandlePrimitive>;
export type DrawerCloseProps = ComponentProps<typeof DrawerClosePrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type DrawerTitleProps = ComponentProps<typeof DrawerTitlePrimitive>;
export type DrawerDescriptionProps = ComponentProps<typeof DrawerDescriptionPrimitive>;

export const DrawerPortal = DrawerPortalPrimitive;

export const Drawer = createComponent(function Drawer(props: DrawerProps, ...children: Child[]) {
	return DrawerPrimitive(props, ...children);
});

export const DrawerTrigger = createComponent(function DrawerTrigger(
	{
		class: className,
		variant = "outline",
		size = "default",
		type = "button",
		...props
	}: DrawerTriggerProps,
	...children: Child[]
) {
	return DrawerTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "drawer-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

/**
 * The scrim. Its opacity is `--ip-drawer-fade`, which the drag drives directly,
 * so the page behind comes back as the panel is pulled away — and stays clear
 * while the panel rests below the snap point the overlay fades in from.
 */
export const DrawerOverlay = createComponent(function DrawerOverlay(
	{ class: className, ...props }: DrawerOverlayProps,
	...children: Child[]
) {
	return DrawerOverlayPrimitive(
		{
			...props,
			"data-slot": "drawer-overlay",
			class: cn(
				"fixed inset-0 z-[calc(50+var(--ip-nested-level,0))] bg-black/50",
				"[opacity:var(--ip-drawer-fade,1)]",
				`transition-[opacity,display] ${EASE} transition-discrete`,
				"data-[state=open]:block",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:opacity-0",
				"starting:data-[state=open]:opacity-0",
				// the panel is following a finger; the scrim has to keep up frame for frame
				"data-[dragging]:transition-none",
				"data-[nested]:bg-transparent",
				className,
			),
		},
		...children,
	);
});

/**
 * Per edge: where the panel sits, which corners it rounds, where it goes when
 * it closes, and the `::after` overscroll patch that keeps the background from
 * peeling away from the edge when a drag pulls the panel past its open stop.
 */
const directionClasses: Record<DrawerDirection, string> = {
	bottom: [
		"inset-x-0 bottom-0 mt-24 max-h-[min(calc(85dvh+var(--ip-drawer-keyboard-inset,0px)),100dvh)] rounded-t-lg border-t",
		"data-[snap-points]:mt-0 data-[snap-points]:h-full data-[snap-points]:max-h-none",
		"data-[state=closed]:[translate:0_100%] starting:data-[state=open]:[translate:0_100%]",
		"after:inset-x-0 after:top-full after:h-[200%]",
	].join(" "),
	top: [
		"inset-x-0 top-0 mb-24 max-h-[min(85dvh,calc(100dvh-var(--ip-drawer-keyboard-inset,0px)))] rounded-b-lg border-b",
		"data-[snap-points]:mb-0 data-[snap-points]:h-full data-[snap-points]:max-h-none",
		"data-[state=closed]:[translate:0_-100%] starting:data-[state=open]:[translate:0_-100%]",
		"after:inset-x-0 after:bottom-full after:h-[200%]",
	].join(" "),
	left: [
		"inset-y-0 left-0 w-3/4 max-w-sm rounded-r-lg border-r",
		"data-[snap-points]:w-full data-[snap-points]:max-w-none",
		"data-[state=closed]:[translate:-100%_0] starting:data-[state=open]:[translate:-100%_0]",
		"after:inset-y-0 after:right-full after:w-[200%]",
	].join(" "),
	right: [
		"inset-y-0 right-0 w-3/4 max-w-sm rounded-l-lg border-l",
		"data-[snap-points]:w-full data-[snap-points]:max-w-none",
		"data-[state=closed]:[translate:100%_0] starting:data-[state=open]:[translate:100%_0]",
		"after:inset-y-0 after:left-full after:w-[200%]",
	].join(" "),
};

/**
 * The panel does not move for the keyboard — it stays anchored, and the
 * keyboard covers the bottom of it, which is what keeps the top of the panel
 * and everything near it exactly where the reader last saw it. This holds the
 * content itself clear: an empty box at the end of the panel's column, as tall
 * as the keyboard, so the flex layout above it lands in the space that is left.
 *
 * It pairs with the height cap in `directionClasses`, which grows by the same
 * inset. Without that the spacer would be squeezed out of a capped panel and
 * take the last of the content down behind the keyboard with it.
 *
 * A spacer rather than `padding-bottom` because padding is the first thing a
 * caller reaches for `class` to change, and this is not theirs to lose.
 *
 * Only for the edges the keyboard rises into. A top drawer hangs from the top
 * of the screen, so a box at the end of its column would grow it further under
 * the keyboard rather than clear of it — that one caps its height instead.
 */
function KeyboardSpacer(): Mountable {
	return Div({
		"data-slot": "drawer-keyboard-spacer",
		"aria-hidden": true,
		class: "h-[var(--ip-drawer-keyboard-inset,0px)] shrink-0",
	});
}

/**
 * Where the grab bar goes, which is always the edge the panel drags out of —
 * not the edge it is anchored to. A bar across the panel for a top or bottom
 * drawer, and one down the side for a left or right one, taken out of flow
 * because a column layout should not be built around 6px of grab bar.
 */
const handleClasses: Record<DrawerDirection, string> = {
	bottom: "mx-auto my-4 h-1.5 w-12",
	top: "mx-auto my-4 h-1.5 w-12",
	left: "absolute top-1/2 right-2.5 h-12 w-1.5 -translate-y-1/2",
	right: "absolute top-1/2 left-2.5 h-12 w-1.5 -translate-y-1/2",
};

/**
 * The panel, with the scrim and the portal already inside it. `DrawerOverlay`
 * and `DrawerPortal` stay exported for a layout that composes the panel out of
 * the primitives — pairing them with this only gets you two scrims.
 */
export const DrawerContent = createComponent(function DrawerContent(
	{
		class: className,
		showHandle = true,
		showCloseButton = false,
		overlay = {},
		...props
	}: DrawerContentProps,
	...children: Child[]
) {
	return DrawerCtx.Use((state) =>
		DrawerPortal(
			DrawerOverlay(overlay),
			DrawerContentPrimitive(
				{
					...props,
					"data-slot": "drawer-content",
					class: cn(
						"fixed z-[calc(50+var(--ip-nested-level,0))] flex flex-col overscroll-contain border-border bg-background text-foreground shadow-lg outline-none pointer-fine:select-none",
						// the panel's own resting place: the active snap point plus the drag
						"[translate:var(--ip-drawer-offset-x,0px)_var(--ip-drawer-offset-y,0px)]",
						`transition-[translate,display] ${EASE} transition-discrete`,
						"data-[state=open]:flex data-[state=closed]:pointer-events-none data-[state=closed]:hidden",
						"data-[dragging]:transition-none",
						// covers the gap a rubber-banded overdrag would otherwise open at the edge
						"after:pointer-events-none after:absolute after:bg-inherit after:content-['']",
						directionClasses[state.direction],
						className,
					),
				},
				// a top drawer drags out of its bottom edge, so the bar belongs after
				// the content rather than before it
				showHandle && state.direction !== "top"
					? DrawerHandle({ class: handleClasses[state.direction] })
					: null,
				...children,
				showHandle && state.direction === "top" ? DrawerHandle({ class: handleClasses.top }) : null,
				state.direction !== "top" ? KeyboardSpacer() : null,
				showCloseButton
					? DrawerClose(
							{
								variant: "ghost",
								size: "icon-sm",
								class: "absolute top-3 right-3",
							},
							XIcon({ class: "size-4", "aria-hidden": true }),
							Span({ class: "sr-only" }, "Close"),
						)
					: null,
			),
		),
	);
});

/**
 * The grab bar. Dragging it moves the panel; tapping it steps to the next snap
 * point and closes from the last one. It carries a 44px hit area that does not
 * change the bar's own size.
 */
export const DrawerHandle = createComponent(function DrawerHandle(
	{ class: className, ...props }: DrawerHandleProps,
	...children: Child[]
) {
	return DrawerHandlePrimitive(
		{
			...props,
			"data-slot": "drawer-handle",
			class: cn(
				"relative shrink-0 cursor-grab touch-none rounded-full bg-muted opacity-70 transition-opacity hover:opacity-100 active:cursor-grabbing active:opacity-100",
				// the bar a bottom drawer wants; DrawerContent overrides it per direction
				"mx-auto my-4 h-1.5 w-12",
				"[&>[data-drawer-handle-hitarea]]:absolute [&>[data-drawer-handle-hitarea]]:top-1/2 [&>[data-drawer-handle-hitarea]]:left-1/2 [&>[data-drawer-handle-hitarea]]:h-[max(100%,2.75rem)] [&>[data-drawer-handle-hitarea]]:w-[max(100%,2.75rem)] [&>[data-drawer-handle-hitarea]]:-translate-x-1/2 [&>[data-drawer-handle-hitarea]]:-translate-y-1/2",
				className,
			),
		},
		...children,
	);
});

export const DrawerTitle = createComponent(function DrawerTitle(
	{ class: className, ...props }: DrawerTitleProps,
	...children: Child[]
) {
	return DrawerTitlePrimitive(
		{
			...props,
			"data-slot": "drawer-title",
			class: cn("text-lg leading-none font-semibold", className),
		},
		...children,
	);
});

export const DrawerDescription = createComponent(function DrawerDescription(
	{ class: className, ...props }: DrawerDescriptionProps,
	...children: Child[]
) {
	return DrawerDescriptionPrimitive(
		{
			...props,
			"data-slot": "drawer-description",
			class: cn("text-sm text-muted-foreground", className),
		},
		...children,
	);
});

export const DrawerClose = createComponent(function DrawerClose(
	{
		class: className,
		variant = "outline",
		size = "default",
		type = "button",
		...props
	}: DrawerCloseProps,
	...children: Child[]
) {
	return DrawerClosePrimitive(
		{
			type,
			...props,
			"data-slot": "drawer-close",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});
