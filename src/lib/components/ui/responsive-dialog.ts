import {
	context,
	If,
	mediaQuery,
	signal,
	type Child,
	type ComponentProps,
	type Signal,
} from "@implementjs/core";
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
	// one signal across both shapes, so a drawer left open on a phone that turns
	// into a tablet comes back as an open dialog rather than nothing at all
	const openSignal: Signal<boolean> = signal(open ?? false);
	const isMobile = mediaQuery(query);

	return If(isMobile)
		.Then(
			ResponsiveDialogCtx.Provide("drawer").To(Drawer({ ...props, open: openSignal }, ...children)),
		)
		.Else(
			ResponsiveDialogCtx.Provide("dialog").To(
				Dialog({ open: openSignal, preventScroll: props.preventScroll }, ...children),
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
