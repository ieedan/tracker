import { Div, type Child, type ComponentProps } from "@implementjs/core";
import {
	Collapsible as CollapsiblePrimitive,
	CollapsibleContent as CollapsibleContentPrimitive,
	CollapsibleTrigger as CollapsibleTriggerPrimitive,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "@/lib/utils";
import { createComponent } from "@implementjs/primitives";

export type CollapsibleProps = ComponentProps<typeof CollapsiblePrimitive>;
export type CollapsibleTriggerProps = ComponentProps<typeof CollapsibleTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};
export type CollapsibleContentProps = ComponentProps<typeof CollapsibleContentPrimitive>;

export const Collapsible = createComponent(function Collapsible(
	{ class: className, ...props }: CollapsibleProps,
	...children: Child[]
) {
	return CollapsiblePrimitive(
		{ "data-slot": "collapsible", class: cn("flex flex-col gap-2", className), ...props },
		...children,
	);
});

export const CollapsibleTrigger = createComponent(function CollapsibleTrigger(
	{
		class: className,
		variant = "ghost",
		size = "default",
		type = "button",
		...props
	}: CollapsibleTriggerProps,
	...children: Child[]
) {
	return CollapsibleTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "collapsible-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export const CollapsibleContent = createComponent(function CollapsibleContent(
	{ class: className, ...props }: CollapsibleContentProps,
	...children: Child[]
) {
	return CollapsibleContentPrimitive(
		{
			...props,
			"data-slot": "collapsible-content",
			class:
				"overflow-hidden text-sm motion-reduce:animate-none data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
		},
		Div({ class: className }, ...children),
	);
});
