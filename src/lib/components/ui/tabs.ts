import { type Child, type ComponentProps } from "@implementjs/core";
import {
	Tabs as TabsPrimitive,
	TabsContent as TabsContentPrimitive,
	TabsList as TabsListPrimitive,
	TabsTrigger as TabsTriggerPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "../../utils";

/**
 * `default` is the segmented control — triggers sit in a filled track. `underline`
 * is the flatter form for prose, where a filled track would read as a component
 * rather than as part of the page.
 */
export const tabsListVariants = tv({
	base: "inline-flex items-center justify-center text-muted-foreground data-[orientation=vertical]:h-fit data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
	variants: {
		variant: {
			default: "h-9 w-fit rounded-lg bg-muted p-[3px]",
			underline:
				"h-auto w-full justify-start gap-4 rounded-none border-b border-border bg-transparent p-0 data-[orientation=vertical]:w-fit data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:border-r",
		},
	},
	defaultVariants: { variant: "default" },
});

export const tabsTriggerVariants = tv({
	base: [
		"inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow,border-color] outline-none",
		"hover:text-foreground",
		"focus-visible:ring-[3px] focus-visible:ring-ring/50",
		"disabled:pointer-events-none disabled:opacity-50",
		"data-[state=active]:text-foreground",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	],
	variants: {
		variant: {
			// shadcn's dark recipe (bg-input/30 on a bg-muted track) has no
			// contrast in this theme, where --input and --muted are both
			// #222 — so the selected tab lifts off the track instead
			default: [
				"h-[calc(100%-1px)] flex-1 rounded-md border border-transparent px-2 py-1",
				"focus-visible:border-ring",
				"data-[state=active]:bg-foreground/10 data-[state=active]:shadow-sm",
				"data-[orientation=vertical]:h-auto data-[orientation=vertical]:justify-start",
			],
			// the trigger's own border sits on top of the list's, so the active
			// one reads as a continuation of the rule rather than a second line
			underline: [
				"-mb-px rounded-none border-b-2 border-transparent px-1 pt-1 pb-2",
				"data-[state=active]:border-foreground",
				"data-[orientation=vertical]:-mr-px data-[orientation=vertical]:justify-start data-[orientation=vertical]:border-r-2 data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:pr-2 data-[orientation=vertical]:pb-1",
			],
		},
	},
	defaultVariants: { variant: "default" },
});

export type TabsVariant = VariantProps<typeof tabsListVariants>["variant"];

export type TabsProps = ComponentProps<typeof TabsPrimitive>;
export type TabsListProps = ComponentProps<typeof TabsListPrimitive> & { variant?: TabsVariant };
export type TabsTriggerProps = ComponentProps<typeof TabsTriggerPrimitive> & {
	variant?: TabsVariant;
};
export type TabsContentProps = ComponentProps<typeof TabsContentPrimitive>;

export const Tabs = createComponent(function Tabs(
	{ class: className, ...props }: TabsProps,
	...children: Child[]
) {
	return TabsPrimitive(
		{
			...props,
			"data-slot": "tabs",
			class: cn("flex flex-col gap-2 data-[orientation=vertical]:flex-row", className),
		},
		...children,
	);
});

export const TabsList = createComponent(function TabsList(
	{ class: className, variant, ...props }: TabsListProps,
	...children: Child[]
) {
	return TabsListPrimitive(
		{
			...props,
			"data-slot": "tabs-list",
			class: cn(tabsListVariants({ variant }), className),
		},
		...children,
	);
});

export const TabsTrigger = createComponent(function TabsTrigger(
	{ class: className, variant, ...props }: TabsTriggerProps,
	...children: Child[]
) {
	return TabsTriggerPrimitive(
		{
			...props,
			"data-slot": "tabs-trigger",
			class: cn(tabsTriggerVariants({ variant }), className),
		},
		...children,
	);
});

export const TabsContent = createComponent(function TabsContent(
	{ class: className, ...props }: TabsContentProps,
	...children: Child[]
) {
	return TabsContentPrimitive(
		{
			...props,
			"data-slot": "tabs-content",
			class: cn(
				"flex-1 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				className,
			),
		},
		...children,
	);
});
