import type { Child, ComponentProps } from "@implementjs/core";
import {
	Tooltip as TooltipPrimitive,
	TooltipContent as TooltipContentPrimitive,
	TooltipPortal as TooltipPortalPrimitive,
	TooltipProvider as TooltipProviderPrimitive,
	TooltipTrigger as TooltipTriggerPrimitive,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "@/lib/utils";
import { createComponent } from "@implementjs/primitives";

export type TooltipProviderProps = ComponentProps<typeof TooltipProviderPrimitive>;
export type TooltipProps = ComponentProps<typeof TooltipPrimitive>;
export type TooltipTriggerProps = ComponentProps<typeof TooltipTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type TooltipContentProps = ComponentProps<typeof TooltipContentPrimitive>;

export const TooltipPortal = TooltipPortalPrimitive;

export const TooltipProvider = createComponent(function TooltipProvider(
	props: TooltipProviderProps,
	...children: Child[]
) {
	return TooltipProviderPrimitive(props, ...children);
});

export const Tooltip = createComponent(function Tooltip(props: TooltipProps, ...children: Child[]) {
	return TooltipPrimitive(props, ...children);
});

export const TooltipTrigger = createComponent(function TooltipTrigger(
	{
		class: className,
		variant = "default",
		size = "default",
		type = "button",
		...props
	}: TooltipTriggerProps,
	...children: Child[]
) {
	return TooltipTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "tooltip-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const TooltipContent = createComponent(function TooltipContent(
	{ offset = 6, side = "top", align = "center", class: className, ...props }: TooltipContentProps,
	...children: Child[]
) {
	return TooltipContentPrimitive(
		{
			...props,
			"data-slot": "tooltip-content",
			offset,
			side,
			align,
			class: cn(
				"absolute z-50 w-fit rounded-md bg-primary px-3 py-1.5 text-xs text-balance text-primary-foreground",
				"origin-(--ip-tooltip-content-transform-origin)",
				"transition-[opacity,translate,scale,display] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
				"not-data-[state=closed]:block not-data-[state=closed]:translate-0 not-data-[state=closed]:scale-100 not-data-[state=closed]:opacity-100",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:scale-95 data-[state=closed]:opacity-0",
				"data-[state=closed]:data-[side=bottom]:-translate-y-2 data-[state=closed]:data-[side=top]:translate-y-2 data-[state=closed]:data-[side=left]:translate-x-2 data-[state=closed]:data-[side=right]:-translate-x-2",
				"starting:not-data-[state=closed]:opacity-0 starting:not-data-[state=closed]:scale-95",
				"starting:not-data-[state=closed]:data-[side=bottom]:-translate-y-2 starting:not-data-[state=closed]:data-[side=top]:translate-y-2 starting:not-data-[state=closed]:data-[side=left]:translate-x-2 starting:not-data-[state=closed]:data-[side=right]:-translate-x-2",
				className,
			),
		},
		...children,
	);
});
