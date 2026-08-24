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

export type DialogProps = ComponentProps<typeof DialogPrimitive>;
export type DialogTriggerProps = ComponentProps<typeof DialogTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type DialogContentProps = ComponentProps<typeof DialogContentPrimitive> & {
	showCloseButton?: boolean;
	/** Props for the overlay the content renders behind itself. */
	overlay?: DialogOverlayProps;
};
export type DialogOverlayProps = ComponentProps<typeof DialogOverlayPrimitive>;
export type DialogCloseProps = ComponentProps<typeof DialogClosePrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type DialogTitleProps = ComponentProps<typeof DialogTitlePrimitive>;
export type DialogDescriptionProps = ComponentProps<typeof DialogDescriptionPrimitive>;

export const DialogPortal = DialogPortalPrimitive;

export const Dialog = createComponent(function Dialog(props: DialogProps, ...children: Child[]) {
	return DialogPrimitive(props, ...children);
});

export const DialogTrigger = createComponent(function DialogTrigger(
	{
		class: className,
		variant = "default",
		size = "default",
		type = "button",
		...props
	}: DialogTriggerProps,
	...children: Child[]
) {
	return DialogTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "dialog-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const DialogOverlay = createComponent(function DialogOverlay(
	{ class: className, ...props }: DialogOverlayProps,
	...children: Child[]
) {
	return DialogOverlayPrimitive(
		{
			...props,
			"data-slot": "dialog-overlay",
			class: cn(
				"fixed inset-0 z-[calc(50+var(--ip-nested-level,0))] bg-black/50",
				"transition-[opacity,display] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
				"data-[state=open]:block data-[state=open]:opacity-100",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:opacity-0",
				"starting:data-[state=open]:opacity-0",
				"data-[nested]:bg-transparent",
				className,
			),
		},
		...children,
	);
});

export const DialogContent = createComponent(function DialogContent(
	{ class: className, showCloseButton = true, overlay = {}, ...props }: DialogContentProps,
	...children: Child[]
) {
	return DialogPortal(
		DialogOverlay(overlay),
		DialogContentPrimitive(
			{
				...props,
				"data-slot": "dialog-content",
				class: cn(
					"fixed top-1/2 left-1/2 z-[calc(50+var(--ip-nested-level,0))] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 text-foreground shadow-lg outline-none sm:max-w-lg",
					"transition-[opacity,scale,translate,display] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
					"data-[state=open]:grid data-[state=open]:scale-[calc(1-0.05*var(--ip-nested-count,0))] data-[state=open]:opacity-100",
					"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:scale-95 data-[state=closed]:opacity-0",
					"starting:data-[state=open]:opacity-0 starting:data-[state=open]:scale-95",
					"data-[nested-open]:-translate-y-[calc(50%+(0.5rem*var(--ip-nested-count,0)))]",
					className,
				),
			},
			...children,
			showCloseButton
				? DialogClose(
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
	);
});

export const DialogTitle = createComponent(function DialogTitle(
	{ class: className, ...props }: DialogTitleProps,
	...children: Child[]
) {
	return DialogTitlePrimitive(
		{
			...props,
			"data-slot": "dialog-title",
			class: cn("text-lg leading-none font-semibold", className),
		},
		...children,
	);
});

export const DialogDescription = createComponent(function DialogDescription(
	{ class: className, ...props }: DialogDescriptionProps,
	...children: Child[]
) {
	return DialogDescriptionPrimitive(
		{
			...props,
			"data-slot": "dialog-description",
			class: cn("text-sm text-muted-foreground", className),
		},
		...children,
	);
});

export const DialogClose = createComponent(function DialogClose(
	{ class: className, variant = "ghost", size = "sm", type = "button", ...props }: DialogCloseProps,
	...children: Child[]
) {
	return DialogClosePrimitive(
		{
			type,
			...props,
			"data-slot": "dialog-close",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});
