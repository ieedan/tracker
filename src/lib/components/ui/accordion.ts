import { Div, type Child, type ComponentProps } from "@implementjs/core";
import { ChevronDownIcon } from "@implementjs/lucide";
import {
	Accordion as AccordionPrimitive,
	AccordionContent as AccordionContentPrimitive,
	AccordionHeader as AccordionHeaderPrimitive,
	AccordionItem as AccordionItemPrimitive,
	AccordionTrigger as AccordionTriggerPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type AccordionProps = ComponentProps<typeof AccordionPrimitive>;
export type AccordionItemProps = ComponentProps<typeof AccordionItemPrimitive>;
export type AccordionHeaderProps = ComponentProps<typeof AccordionHeaderPrimitive>;
export type AccordionTriggerProps = ComponentProps<typeof AccordionTriggerPrimitive>;
export type AccordionContentProps = ComponentProps<typeof AccordionContentPrimitive>;

export const Accordion = createComponent(function Accordion(
	{ class: className, ...props }: AccordionProps,
	...children: Child[]
) {
	return AccordionPrimitive({ "data-slot": "accordion", class: className, ...props }, ...children);
});

export const AccordionItem = createComponent(function AccordionItem(
	{ class: className, ...props }: AccordionItemProps,
	...children: Child[]
) {
	return AccordionItemPrimitive(
		{
			...props,
			"data-slot": "accordion-item",
			class: cn("border-b last:border-b-0", className),
		},
		...children,
	);
});

export const AccordionHeader = createComponent(function AccordionHeader(
	{ class: className, ...props }: AccordionHeaderProps,
	...children: Child[]
) {
	return AccordionHeaderPrimitive({ ...props, class: cn("flex", className) }, ...children);
});

export const AccordionTrigger = createComponent(function AccordionTrigger(
	{ class: className, ...props }: AccordionTriggerProps,
	...children: Child[]
) {
	return AccordionHeader(
		{ class: "flex" },
		AccordionTriggerPrimitive(
			{
				...props,
				"data-slot": "accordion-trigger",
				class: cn(
					"flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
					className,
				),
			},
			...children,
			ChevronDownIcon({
				"aria-hidden": true,
				class:
					"pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200 ease-in-out",
			}),
		),
	);
});

export const AccordionContent = createComponent(function AccordionContent(
	{ class: className, ...props }: AccordionContentProps,
	...children: Child[]
) {
	return AccordionContentPrimitive(
		{
			...props,
			"data-slot": "accordion-content",
			class:
				"overflow-hidden text-sm motion-reduce:animate-none data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
		},
		Div({ class: cn("pt-0 pb-4", className) }, ...children),
	);
});
