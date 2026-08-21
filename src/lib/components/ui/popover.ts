import type { Child, ComponentProps } from "@implementjs/core";
import {
	Popover as PopoverPrimitive,
	PopoverClose as PopoverClosePrimitive,
	PopoverContent as PopoverContentPrimitive,
	PopoverPortal as PopoverPortalPrimitive,
	PopoverTrigger as PopoverTriggerPrimitive,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "../../utils";
import { createComponent } from "@implementjs/primitives";

export type PopoverProps = ComponentProps<typeof PopoverPrimitive>;
export type PopoverTriggerProps = ComponentProps<typeof PopoverTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type PopoverContentProps = ComponentProps<typeof PopoverContentPrimitive>;
export type PopoverCloseProps = ComponentProps<typeof PopoverClosePrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};

export const PopoverPortal = PopoverPortalPrimitive;

export const Popover = createComponent(function Popover(props: PopoverProps, ...children: Child[]) {
	return PopoverPrimitive(props, ...children);
});

export const PopoverTrigger = createComponent(function PopoverTrigger(
	{
		class: className,
		variant = "default",
		size = "default",
		type = "button",
		...props
	}: PopoverTriggerProps,
	...children: Child[]
) {
	return PopoverTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "popover-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const PopoverContent = createComponent(function PopoverContent(
	{ offset = 5, side = "bottom", align = "start", class: className, ...props }: PopoverContentProps,
	...children: Child[]
) {
	return PopoverContentPrimitive(
		{
			...props,
			"data-slot": "popover-content",
			offset,
			side,
			align,
			class: cn(
				"absolute z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
				"origin-(--ip-popover-content-transform-origin)",
				"transition-[opacity,translate,scale,display] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
				"data-[state=open]:block data-[state=open]:translate-0 data-[state=open]:scale-100 data-[state=open]:opacity-100",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:scale-95 data-[state=closed]:opacity-0",
				"data-[state=closed]:data-[side=bottom]:-translate-y-2 data-[state=closed]:data-[side=top]:translate-y-2 data-[state=closed]:data-[side=left]:translate-x-2 data-[state=closed]:data-[side=right]:-translate-x-2",
				"starting:data-[state=open]:opacity-0 starting:data-[state=open]:scale-95",
				"starting:data-[state=open]:data-[side=bottom]:-translate-y-2 starting:data-[state=open]:data-[side=top]:translate-y-2 starting:data-[state=open]:data-[side=left]:translate-x-2 starting:data-[state=open]:data-[side=right]:-translate-x-2",
				className,
			),
		},
		...children,
	);
});

export const PopoverClose = createComponent(function PopoverClose(
	{
		class: className,
		variant = "ghost",
		size = "sm",
		type = "button",
		...props
	}: PopoverCloseProps,
	...children: Child[]
) {
	return PopoverClosePrimitive(
		{
			type,
			...props,
			"data-slot": "popover-close",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});
