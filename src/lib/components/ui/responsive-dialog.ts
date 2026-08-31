import {
	Div,
	Fragment,
	If,
	ImplementLifecycle,
	Span,
	context,
	signal,
	type Child,
	type ComponentProps,
	type ElementProps,
	type Mountable,
	type Signal,
} from "@implementjs/core";
import { XIcon } from "@implementjs/lucide";
import { createComponent } from "@implementjs/primitives";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "./dialog";
import { Drawer, DrawerContent } from "./drawer";
import { cn } from "@/lib/utils";

/**
 * One modal, two shapes: a centered dialog where there is room for one, and a
 * drawer up from the bottom edge where a thumb is what is reaching for it.
 *
 * The two share everything below the panel — `Drawer` and `Dialog` are the same
 * modal primitive underneath, so the title, description, and close are one
 * component each and pick up whichever root they find themselves in. Only the
 * root and the panel differ, and only the root reads the viewport.
 */

/** Below this the dialog becomes a drawer. Matches the sidebar's breakpoint. */
export const RESPONSIVE_DIALOG_QUERY = "(max-width: 767px)";

/**
 * Which shape the surrounding root took. Read at mount, so a responsive dialog
 * nested inside a real drawer cannot mistake the outer one for its own.
 */
const ResponsiveDialogCtx = context<"drawer" | "dialog">("ResponsiveDialogCtx");

export type ResponsiveDialogProps = ComponentProps<typeof Dialog> &
	ComponentProps<typeof Drawer> & {
		/** The media query that picks the drawer. Defaults to `(max-width: 767px)`. */
		query?: string;
	};
export type ResponsiveDialogTriggerProps = ComponentProps<typeof DialogTrigger>;
export type ResponsiveDialogContentProps = ComponentProps<typeof DialogContent> &
	ComponentProps<typeof DrawerContent>;
export type ResponsiveDialogTitleProps = ComponentProps<typeof DialogTitle>;
export type ResponsiveDialogDescriptionProps = ComponentProps<typeof DialogDescription>;
export type ResponsiveDialogCloseProps = ComponentProps<typeof DialogClose>;

export const ResponsiveDialog = createComponent(function ResponsiveDialog(
	{ open, query = RESPONSIVE_DIALOG_QUERY, ...props }: ResponsiveDialogProps,
	...children: Child[]
) {
	// one signal across both shapes, so the modal cannot lose its open state to
	// the shape decision below
	const openSignal: Signal<boolean> = signal(open ?? false);

	// The shape is decided once per mount, on the client — NOT tracked live from
	// the media query. Following the viewport would remount the same children
	// from one root into the other, and a remounted DropdownMenu never opens
	// again (implementjs ENG-28): on a phone the SSR answer is "desktop", so
	// every picker inside the drawer arrived already broken. A dialog is closed
	// while nothing is looking at it, so mounting neither shape during SSR shows
	// nothing less; the price is that crossing the breakpoint after load keeps
	// the shape until the next mount.
	const shape = signal<"drawer" | "dialog" | null>(null);

	return Fragment(
		ImplementLifecycle({
			onMount: () => shape.set(window.matchMedia(query).matches ? "drawer" : "dialog"),
		}),
		If(
			shape.bind((value) => value === "drawer"),
			ResponsiveDialogCtx.Provide("drawer").To(Drawer({ ...props, open: openSignal }, ...children)),
		).ElseIf(
			shape.bind((value) => value === "dialog"),
			ResponsiveDialogCtx.Provide("dialog").To(
				Dialog({ open: openSignal, preventScroll: props.preventScroll }, ...children),
			),
		),
	);
});

export const ResponsiveDialogTrigger = createComponent(function ResponsiveDialogTrigger(
	{ variant = "outline", ...props }: ResponsiveDialogTriggerProps,
	...children: Child[]
) {
	return DialogTrigger(
		{ variant, ...props, "data-slot": "responsive-dialog-trigger" },
		...children,
	);
});

/**
 * The panel: a centered dialog, or a drawer from the bottom edge. Both bring
 * their own scrim and portal, and both take the props of whichever they are —
 * `showHandle` reaches the drawer, `showCloseButton` reaches either.
 */
export const ResponsiveDialogContent = createComponent(function ResponsiveDialogContent(
	props: ResponsiveDialogContentProps,
	...children: Child[]
) {
	return ResponsiveDialogCtx.Use((shape) =>
		// each shape names itself: the panel comes back as data-slot="drawer-content"
		// or "dialog-content", which is what a stylesheet or a test wants to know
		shape === "drawer" ? DrawerContent(props, ...children) : DialogContent(props, ...children),
	);
});

/**
 * The title, description, and close are the same components under either shape:
 * `Drawer` and `Dialog` are one primitive, so these resolve against whichever
 * root is above them and pick up its data attributes.
 */
export const ResponsiveDialogTitle = createComponent(function ResponsiveDialogTitle(
	props: ResponsiveDialogTitleProps,
	...children: Child[]
) {
	return DialogTitle(props, ...children);
});

export const ResponsiveDialogDescription = createComponent(function ResponsiveDialogDescription(
	props: ResponsiveDialogDescriptionProps,
	...children: Child[]
) {
	return DialogDescription(props, ...children);
});

export const ResponsiveDialogClose = createComponent(function ResponsiveDialogClose(
	props: ResponsiveDialogCloseProps,
	...children: Child[]
) {
	return DialogClose(props, ...children);
});

/**
 * Branch a layout on the shape the surrounding root took. For the few places
 * where the two are not the same arrangement of the same parts — a phone puts
 * the panel's action in a corner where the footer holding it does not exist.
 */
export function ResponsiveDialogShape(render: (shape: "drawer" | "dialog") => Child): Mountable {
	return ResponsiveDialogCtx.Use(render);
}

/**
 * The panel a header/body/footer is built into: a column with a ceiling, so the
 * body can take what is left of it and scroll inside that rather than running
 * the rest of the form off the bottom edge.
 *
 * The ceiling is only set above the breakpoint. Below it the panel is a drawer,
 * which caps its own height against the on-screen keyboard, and a second
 * `max-height` here would be the one tailwind-merge kept.
 *
 * `data-[state=open]:flex` because the dialog sets `grid` on its own open
 * state, and that is the more specific of the two rules.
 */
export const RESPONSIVE_DIALOG_PANEL =
	"flex flex-col data-[state=open]:flex md:max-h-[min(85dvh,44rem)] md:overflow-hidden";

export type ResponsiveDialogHeaderProps = {
	class?: string;
	/**
	 * The panel's primary action, in the drawer's top-right corner — a submit,
	 * normally. Only built when the panel took that shape, so a dialog (which
	 * keeps its action in the footer) never constructs a button it will not show.
	 */
	action?: () => Child;
	/** Accessible name for the drawer's close control. Defaults to "Close". */
	closeLabel?: string;
};

/**
 * The panel's top bar, holding the title and description it is given.
 *
 * On a drawer it is also the whole of the chrome: close in the top-left corner
 * and the action in the top-right, both under a thumb, and neither of them
 * below a form that has to be scrolled past to reach them. On a dialog it is
 * the header it has always been — the title over its description — and the
 * action stays in the footer with the rest of the buttons.
 */
export const ResponsiveDialogHeader = createComponent(function ResponsiveDialogHeader(
	{ class: className, action, closeLabel = "Close" }: ResponsiveDialogHeaderProps,
	...children: Child[]
) {
	return ResponsiveDialogCtx.Use((shape) =>
		shape === "drawer"
			? Div(
					{
						"data-slot": "responsive-dialog-header",
						class: cn(
							// `1fr auto 1fr` rather than a flex row: equal side columns put
							// the title at the middle of the bar rather than at the middle
							// of what a wide action button left over.
							"grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 border-b border-border px-2 py-2",
							// …but only while the middle column stays narrow enough for
							// those side columns to reach the same width. A description is
							// a sentence, and a sentence between the two corner buttons
							// takes that room back and pulls the title off centre with it.
							// So it drops to a row of its own, full width, where it has
							// space to wrap and nothing left to push against. A header
							// with no description simply has no second row.
							"[&>[data-slot='dialog-description']]:col-span-3 [&>[data-slot='dialog-description']]:row-start-2 [&>[data-slot='dialog-description']]:text-center [&>[data-slot='dialog-description']]:text-[11px]",
							"[&_[data-slot='dialog-title']]:min-w-0 [&_[data-slot='dialog-title']]:truncate [&_[data-slot='dialog-title']]:text-center [&_[data-slot='dialog-title']]:text-[15px] [&_[data-slot='dialog-title']]:leading-tight",
							className,
						),
					},
					DialogClose(
						{
							variant: "outline",
							size: "icon",
							class: "col-start-1 row-start-1 justify-self-start rounded-full",
						},
						XIcon({ class: "size-5", "aria-hidden": true }),
						Span({ class: "sr-only" }, closeLabel),
					),
					// The title lands in the middle cell on its own — the only child
					// with no placement of its own, and the only cell left in row one.
					...children,
					// The third column holds the bar's symmetry even when there is no
					// action to fill it. Round, and the same height as the close in the
					// other corner, whatever size the caller built its button at.
					action === undefined
						? Div({ class: "col-start-3 row-start-1", "aria-hidden": true })
						: Div(
								{
									class:
										"col-start-3 row-start-1 justify-self-end [&>[data-slot='button']]:h-9 [&>[data-slot='button']]:rounded-full",
								},
								action(),
							),
				)
			: Div(
					{
						"data-slot": "responsive-dialog-header",
						class: cn("flex flex-col gap-1 border-b border-border px-4 py-3", className),
					},
					...children,
				),
	);
});

export type ResponsiveDialogBodyProps = ElementProps<"div">;

/**
 * The one region of the panel that scrolls. It takes whatever the header and
 * footer leave and keeps its overflow to itself, which is what holds the
 * corners — and the action in one of them — on screen.
 */
export const ResponsiveDialogBody = createComponent(function ResponsiveDialogBody(
	{ class: className, ...props }: ResponsiveDialogBodyProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "responsive-dialog-body",
			class: cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className),
		},
		...children,
	);
});

export type ResponsiveDialogFooterProps = {
	class?: string;
};

/**
 * The dialog's button row. A drawer renders nothing: its action moved to the
 * header, and what is left of a footer there — a Cancel next to a close button
 * that already cancels — is a row of chrome charging rent on a phone screen.
 */
export const ResponsiveDialogFooter = createComponent(function ResponsiveDialogFooter(
	{ class: className }: ResponsiveDialogFooterProps,
	...children: Child[]
) {
	return ResponsiveDialogCtx.Use((shape) =>
		shape === "drawer"
			? null
			: Div(
					{
						"data-slot": "responsive-dialog-footer",
						class: cn(
							"flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5",
							className,
						),
					},
					...children,
				),
	);
});
