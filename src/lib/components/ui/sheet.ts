import { Span, type Child, type ComponentProps } from "@implementjs/core";
import { XIcon } from "@implementjs/lucide";
import {
	Dialog as DialogPrimitive,
	DialogClose as DialogClosePrimitive,
	DialogContent as DialogContentPrimitive,
	DialogDescription as DialogDescriptionPrimitive,
	DialogOverlay as DialogOverlayPrimitive,
	DialogPortal as DialogPortalPrimitive,
	DialogTitle as DialogTitlePrimitive,
	DialogTrigger as DialogTriggerPrimitive,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "../../utils";
import { createComponent } from "@implementjs/primitives";

/**
 * A sheet is the dialog primitive wearing a drawer costume: same focus trap,
 * escape/outside dismissal, and aria wiring, but the content slides in from
 * an edge instead of centering. The root renders no wrapper, so it can wrap
 * a whole layout — put the `SheetTrigger` wherever it lives and the
 * dismissable layer treats it as an anchor (no toggle/outside-close fights).
 */

export type SheetSide = "left" | "right" | "top" | "bottom";

export type SheetProps = ComponentProps<typeof DialogPrimitive>;
export type SheetTriggerProps = ComponentProps<typeof DialogTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type SheetOverlayProps = ComponentProps<typeof DialogOverlayPrimitive>;
export type SheetContentProps = ComponentProps<typeof DialogContentPrimitive> & {
	side?: SheetSide;
	showCloseButton?: boolean;
	/** Props for the overlay the content renders behind itself. */
	overlay?: SheetOverlayProps;
};
export type SheetCloseProps = ComponentProps<typeof DialogClosePrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type SheetTitleProps = ComponentProps<typeof DialogTitlePrimitive>;
export type SheetDescriptionProps = ComponentProps<typeof DialogDescriptionPrimitive>;

export const SheetPortal = DialogPortalPrimitive;

export const Sheet = createComponent(function Sheet(props: SheetProps, ...children: Child[]) {
	return DialogPrimitive(props, ...children);
});

export const SheetTrigger = createComponent(function SheetTrigger(
	{
		class: className,
		variant = "ghost",
		size = "icon-sm",
		type = "button",
		...props
	}: SheetTriggerProps,
	...children: Child[]
) {
	return DialogTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "sheet-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const SheetOverlay = createComponent(function SheetOverlay(
	{ class: className, ...props }: SheetOverlayProps,
	...children: Child[]
) {
	return DialogOverlayPrimitive(
		{
			...props,
			"data-slot": "sheet-overlay",
			class: cn(
				"fixed inset-0 z-50 bg-black/50",
				"transition-[opacity,display] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
				"data-[state=open]:block data-[state=open]:opacity-100",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:opacity-0",
				"starting:data-[state=open]:opacity-0",
				className,
			),
		},
		...children,
	);
});

const sideClasses: Record<SheetSide, string> = {
	left: [
		"inset-y-0 left-0 h-full w-72 max-w-[85vw] border-r border-border",
		"data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full",
		"starting:data-[state=open]:-translate-x-full",
	].join(" "),
	right: [
		"inset-y-0 right-0 h-full w-72 max-w-[85vw] border-l border-border",
		"data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full",
		"starting:data-[state=open]:translate-x-full",
	].join(" "),
	top: [
		"inset-x-0 top-0 max-h-[85dvh] border-b border-border",
		"data-[state=open]:translate-y-0 data-[state=closed]:-translate-y-full",
		"starting:data-[state=open]:-translate-y-full",
	].join(" "),
	bottom: [
		"inset-x-0 bottom-0 max-h-[85dvh] border-t border-border",
		"data-[state=open]:translate-y-0 data-[state=closed]:translate-y-full",
		"starting:data-[state=open]:translate-y-full",
	].join(" "),
};

export const SheetContent = createComponent(function SheetContent(
	{
		side = "left",
		class: className,
		showCloseButton = true,
		overlay = {},
		...props
	}: SheetContentProps,
	...children: Child[]
) {
	return SheetPortal(
		SheetOverlay(overlay),
		DialogContentPrimitive(
			{
				...props,
				"data-slot": "sheet-content",
				class: cn(
					"fixed z-50 flex flex-col bg-background text-foreground shadow-lg outline-none",
					"transition-[translate,display] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
					"data-[state=open]:flex data-[state=closed]:pointer-events-none data-[state=closed]:hidden",
					sideClasses[side],
					className,
				),
			},
			...children,
			showCloseButton
				? SheetClose(
						{
							variant: "ghost",
							size: "icon-sm",
							class: "absolute top-2.5 right-2.5",
						},
						XIcon({ class: "size-4", "aria-hidden": true }),
						Span({ class: "sr-only" }, "Close"),
					)
				: null,
		),
	);
});

export const SheetTitle = createComponent(function SheetTitle(
	{ class: className, ...props }: SheetTitleProps,
	...children: Child[]
) {
	return DialogTitlePrimitive(
		{
			...props,
			"data-slot": "sheet-title",
			class: cn("text-sm font-semibold", className),
		},
		...children,
	);
});

export const SheetDescription = createComponent(function SheetDescription(
	{ class: className, ...props }: SheetDescriptionProps,
	...children: Child[]
) {
	return DialogDescriptionPrimitive(
		{
			...props,
			"data-slot": "sheet-description",
			class: cn("text-sm text-muted-foreground", className),
		},
		...children,
	);
});

export const SheetClose = createComponent(function SheetClose(
	{ class: className, variant = "ghost", size = "sm", type = "button", ...props }: SheetCloseProps,
	...children: Child[]
) {
	return DialogClosePrimitive(
		{
			type,
			...props,
			"data-slot": "sheet-close",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});
