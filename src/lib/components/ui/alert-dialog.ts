import { type Child, type ComponentProps } from "@implementjs/core";
import {
	AlertDialog as AlertDialogPrimitive,
	AlertDialogAction as AlertDialogActionPrimitive,
	AlertDialogCancel as AlertDialogCancelPrimitive,
	AlertDialogContent as AlertDialogContentPrimitive,
	AlertDialogDescription as AlertDialogDescriptionPrimitive,
	AlertDialogOverlay as AlertDialogOverlayPrimitive,
	AlertDialogPortal as AlertDialogPortalPrimitive,
	AlertDialogTitle as AlertDialogTitlePrimitive,
	AlertDialogTrigger as AlertDialogTriggerPrimitive,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { TabOrder } from "./tab-order";
import { swallowTapThrough } from "./tap-through";
import { cn } from "@/lib/utils";
import { createComponent, mergeProps } from "@implementjs/primitives";

export type AlertDialogProps = ComponentProps<typeof AlertDialogPrimitive>;
export type AlertDialogTriggerProps = ComponentProps<typeof AlertDialogTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type AlertDialogOverlayProps = ComponentProps<typeof AlertDialogOverlayPrimitive>;
export type AlertDialogContentProps = ComponentProps<typeof AlertDialogContentPrimitive> & {
	/** Props for the overlay the content renders behind itself. */
	overlay?: AlertDialogOverlayProps;
};
export type AlertDialogCancelProps = ComponentProps<typeof AlertDialogCancelPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type AlertDialogActionProps = ComponentProps<typeof AlertDialogActionPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type AlertDialogTitleProps = ComponentProps<typeof AlertDialogTitlePrimitive>;
export type AlertDialogDescriptionProps = ComponentProps<typeof AlertDialogDescriptionPrimitive>;

export const AlertDialogPortal = AlertDialogPortalPrimitive;

export const AlertDialog = createComponent(function AlertDialog(
	props: AlertDialogProps,
	...children: Child[]
) {
	return AlertDialogPrimitive(props, ...children);
});

export const AlertDialogTrigger = createComponent(function AlertDialogTrigger(
	{
		class: className,
		variant = "default",
		size = "default",
		type = "button",
		...props
	}: AlertDialogTriggerProps,
	...children: Child[]
) {
	return AlertDialogTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "alert-dialog-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const AlertDialogOverlay = createComponent(function AlertDialogOverlay(
	{ class: className, ...props }: AlertDialogOverlayProps,
	...children: Child[]
) {
	return AlertDialogOverlayPrimitive(
		// A tap on the scrim dismisses the alert dialog, and must not also click
		// the page it was covering. See `swallowTapThrough` (ENG-69).
		mergeProps(
			{ onPointerdown: swallowTapThrough },
			{
				...props,
				"data-slot": "alert-dialog-overlay",
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
		),
		...children,
	);
});

export const AlertDialogContent = createComponent(function AlertDialogContent(
	{ class: className, overlay = {}, ...props }: AlertDialogContentProps,
	...children: Child[]
) {
	return AlertDialogPortal(
		AlertDialogOverlay(overlay),
		AlertDialogContentPrimitive(
			{
				...props,
				"data-slot": "alert-dialog-content",
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
			// Same trap as the dialog's, and the same fix: Tab skips controls that
			// are in the DOM without being rendered. See `TabOrder`.
			TabOrder(...children),
		),
	);
});

export const AlertDialogTitle = createComponent(function AlertDialogTitle(
	{ class: className, ...props }: AlertDialogTitleProps,
	...children: Child[]
) {
	return AlertDialogTitlePrimitive(
		{
			...props,
			"data-slot": "alert-dialog-title",
			class: cn("text-lg leading-none font-semibold", className),
		},
		...children,
	);
});

export const AlertDialogDescription = createComponent(function AlertDialogDescription(
	{ class: className, ...props }: AlertDialogDescriptionProps,
	...children: Child[]
) {
	return AlertDialogDescriptionPrimitive(
		{
			...props,
			"data-slot": "alert-dialog-description",
			class: cn("text-sm text-muted-foreground", className),
		},
		...children,
	);
});

export const AlertDialogCancel = createComponent(function AlertDialogCancel(
	{
		class: className,
		variant = "outline",
		size = "default",
		type = "button",
		...props
	}: AlertDialogCancelProps,
	...children: Child[]
) {
	return AlertDialogCancelPrimitive(
		{
			type,
			...props,
			"data-slot": "alert-dialog-cancel",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const AlertDialogAction = createComponent(function AlertDialogAction(
	{
		class: className,
		variant = "default",
		size = "default",
		type = "button",
		...props
	}: AlertDialogActionProps,
	...children: Child[]
) {
	return AlertDialogActionPrimitive(
		{
			type,
			...props,
			"data-slot": "alert-dialog-action",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});
