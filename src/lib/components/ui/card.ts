import { Div, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type CardProps = ElementProps<"div">;
export type CardHeaderProps = ElementProps<"div">;
export type CardTitleProps = ElementProps<"div">;
export type CardDescriptionProps = ElementProps<"div">;
export type CardActionProps = ElementProps<"div">;
export type CardContentProps = ElementProps<"div">;
export type CardFooterProps = ElementProps<"div">;

/** A bordered surface holding one self-contained piece of the page. */
export const Card = createComponent(function Card(
	{ class: className, ...props }: CardProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "card",
			class: cn(
				"flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",
				className,
			),
		},
		...children,
	);
});

/**
 * The header row. It is a grid rather than a flex row so that `CardAction`
 * can sit in a second column without the title and description having to
 * know it is there — the grid gains the column only when an action exists.
 */
export const CardHeader = createComponent(function CardHeader(
	{ class: className, ...props }: CardHeaderProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "card-header",
			class: cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6",
				"has-data-[slot=card-action]:grid-cols-[1fr_auto]",
				"[.border-b]:pb-6",
				className,
			),
		},
		...children,
	);
});

export const CardTitle = createComponent(function CardTitle(
	{ class: className, ...props }: CardTitleProps,
	...children: Child[]
) {
	return Div(
		{ ...props, "data-slot": "card-title", class: cn("leading-none font-semibold", className) },
		...children,
	);
});

export const CardDescription = createComponent(function CardDescription(
	{ class: className, ...props }: CardDescriptionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "card-description",
			class: cn("text-sm text-muted-foreground", className),
		},
		...children,
	);
});

/** A control in the top right of the header — a menu, a link, a switch. */
export const CardAction = createComponent(function CardAction(
	{ class: className, ...props }: CardActionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "card-action",
			class: cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className),
		},
		...children,
	);
});

export const CardContent = createComponent(function CardContent(
	{ class: className, ...props }: CardContentProps,
	...children: Child[]
) {
	return Div({ ...props, "data-slot": "card-content", class: cn("px-6", className) }, ...children);
});

export const CardFooter = createComponent(function CardFooter(
	{ class: className, ...props }: CardFooterProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "card-footer",
			class: cn("flex items-center px-6 [.border-t]:pt-6", className),
		},
		...children,
	);
});
