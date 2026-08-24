import { Div, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "@/lib/utils";

export const emptyMediaVariants = tv({
	base: "mb-2 flex shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-6",
	variants: {
		variant: {
			default: "bg-transparent",
			icon: "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground",
		},
	},
	defaultVariants: { variant: "default" },
});

export type EmptyMediaVariant = VariantProps<typeof emptyMediaVariants>["variant"];

export type EmptyProps = ElementProps<"div">;
export type EmptyHeaderProps = ElementProps<"div">;
export type EmptyMediaProps = ElementProps<"div"> & VariantProps<typeof emptyMediaVariants>;
export type EmptyTitleProps = ElementProps<"div">;
export type EmptyDescriptionProps = ElementProps<"div">;
export type EmptyContentProps = ElementProps<"div">;

/**
 * The state a list is in before it has anything in it. An empty state that
 * says what the thing is and offers the first step is worth more than a
 * blank panel, which is all this arranges: media, a title, a line of
 * explanation, and somewhere to put the action.
 */
export const Empty = createComponent(function Empty(
	{ class: className, ...props }: EmptyProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "empty",
			class: cn(
				"flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12",
				className,
			),
		},
		...children,
	);
});

export const EmptyHeader = createComponent(function EmptyHeader(
	{ class: className, ...props }: EmptyHeaderProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "empty-header",
			class: cn("flex max-w-sm flex-col items-center gap-2 text-center", className),
		},
		...children,
	);
});

/** The icon or illustration above the title. `icon` gives it a filled tile. */
export const EmptyMedia = createComponent(function EmptyMedia(
	{ class: className, variant = "default", ...props }: EmptyMediaProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "empty-media",
			"data-variant": variant,
			class: cn(emptyMediaVariants({ variant }), className),
		},
		...children,
	);
});

export const EmptyTitle = createComponent(function EmptyTitle(
	{ class: className, ...props }: EmptyTitleProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "empty-title",
			class: cn("text-lg font-medium tracking-tight", className),
		},
		...children,
	);
});

export const EmptyDescription = createComponent(function EmptyDescription(
	{ class: className, ...props }: EmptyDescriptionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "empty-description",
			class: cn(
				"text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
				className,
			),
		},
		...children,
	);
});

/** Whatever comes after the message — a button, a form, a hint. */
export const EmptyContent = createComponent(function EmptyContent(
	{ class: className, ...props }: EmptyContentProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "empty-content",
			class: cn(
				"flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
				className,
			),
		},
		...children,
	);
});
