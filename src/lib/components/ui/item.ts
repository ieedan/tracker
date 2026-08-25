import { Div, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "@/lib/utils";

export const itemVariants = tv({
	base: "group/item flex flex-wrap items-center rounded-md border border-transparent text-sm outline-none transition-colors duration-100 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a&]:hover:bg-accent/50 [a&]:transition-colors",
	variants: {
		variant: {
			default: "bg-transparent",
			outline: "border-border",
			muted: "bg-muted/50",
		},
		size: {
			default: "gap-4 p-4",
			sm: "gap-2.5 px-4 py-3",
		},
	},
	defaultVariants: { variant: "default", size: "default" },
});

export const itemMediaVariants = tv({
	base: "flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none",
	variants: {
		variant: {
			default: "bg-transparent",
			icon: "size-8 rounded-sm border bg-muted [&_svg:not([class*='size-'])]:size-4",
			image: "size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover",
		},
	},
	defaultVariants: { variant: "default" },
});

export type ItemVariant = VariantProps<typeof itemVariants>["variant"];
export type ItemSize = VariantProps<typeof itemVariants>["size"];
export type ItemMediaVariant = VariantProps<typeof itemMediaVariants>["variant"];

export type ItemGroupProps = ElementProps<"div">;
export type ItemSeparatorProps = ElementProps<"div">;
export type ItemProps = ElementProps<"div"> & VariantProps<typeof itemVariants>;
export type ItemMediaProps = ElementProps<"div"> & VariantProps<typeof itemMediaVariants>;
export type ItemContentProps = ElementProps<"div">;
export type ItemTitleProps = ElementProps<"div">;
export type ItemDescriptionProps = ElementProps<"div">;
export type ItemActionsProps = ElementProps<"div">;
export type ItemHeaderProps = ElementProps<"div">;
export type ItemFooterProps = ElementProps<"div">;

/** A list of items. */
export const ItemGroup = createComponent(function ItemGroup(
	{ class: className, ...props }: ItemGroupProps,
	...children: Child[]
) {
	return Div(
		{
			role: "list",
			...props,
			"data-slot": "item-group",
			class: cn("group/item-group flex flex-col", className),
		},
		...children,
	);
});

export const ItemSeparator = createComponent(function ItemSeparator({
	class: className,
	...props
}: ItemSeparatorProps) {
	return Div({
		role: "separator",
		...props,
		"data-slot": "item-separator",
		class: cn("my-0 h-px shrink-0 bg-border", className),
	});
});

/**
 * One row of a list: something on the left, a title and description in the
 * middle, controls on the right. The generic shape that a settings row, a
 * search result, and a file listing all turn out to be.
 *
 * The media block self-aligns to the top only when the row has a
 * description, so single-line rows stay vertically centered.
 */
export const Item = createComponent(function Item(
	{ class: className, variant = "default", size = "default", ...props }: ItemProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item",
			"data-variant": variant,
			"data-size": size,
			class: cn(itemVariants({ variant, size }), className),
		},
		...children,
	);
});

/** The leading block: an icon in a tile, an image, or an avatar. */
export const ItemMedia = createComponent(function ItemMedia(
	{ class: className, variant = "default", ...props }: ItemMediaProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item-media",
			"data-variant": variant,
			class: cn(itemMediaVariants({ variant }), className),
		},
		...children,
	);
});

export const ItemContent = createComponent(function ItemContent(
	{ class: className, ...props }: ItemContentProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item-content",
			class: cn("flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none", className),
		},
		...children,
	);
});

export const ItemTitle = createComponent(function ItemTitle(
	{ class: className, ...props }: ItemTitleProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item-title",
			class: cn("flex w-fit items-center gap-2 text-sm leading-snug font-medium", className),
		},
		...children,
	);
});

export const ItemDescription = createComponent(function ItemDescription(
	{ class: className, ...props }: ItemDescriptionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item-description",
			class: cn(
				"line-clamp-2 text-sm leading-normal font-normal text-balance text-muted-foreground",
				"[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
				className,
			),
		},
		...children,
	);
});

/** The trailing block: buttons, a menu, a switch. */
export const ItemActions = createComponent(function ItemActions(
	{ class: className, ...props }: ItemActionsProps,
	...children: Child[]
) {
	return Div(
		{ ...props, "data-slot": "item-actions", class: cn("flex items-center gap-2", className) },
		...children,
	);
});

export const ItemHeader = createComponent(function ItemHeader(
	{ class: className, ...props }: ItemHeaderProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item-header",
			class: cn("flex basis-full items-center justify-between gap-2", className),
		},
		...children,
	);
});

export const ItemFooter = createComponent(function ItemFooter(
	{ class: className, ...props }: ItemFooterProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "item-footer",
			class: cn("flex basis-full items-center justify-between gap-2", className),
		},
		...children,
	);
});
