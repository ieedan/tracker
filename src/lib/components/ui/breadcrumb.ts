import { A, Li, Nav, Ol, Span, type Child, type ElementProps } from "@implementjs/core";
import { ChevronRightIcon, EllipsisIcon } from "@implementjs/lucide";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type BreadcrumbProps = ElementProps<"nav">;
export type BreadcrumbListProps = ElementProps<"ol">;
export type BreadcrumbItemProps = ElementProps<"li">;
export type BreadcrumbLinkProps = ElementProps<"a">;
export type BreadcrumbPageProps = ElementProps<"span">;
export type BreadcrumbSeparatorProps = ElementProps<"li">;
export type BreadcrumbEllipsisProps = ElementProps<"span">;

/**
 * The trail back up from where you are. The root is a labelled `nav`, the
 * trail an ordered list, and the last crumb is a `BreadcrumbPage` rather
 * than a link — you do not link to the page you are on.
 */
export const Breadcrumb = createComponent(function Breadcrumb(
	{ class: className, ...props }: BreadcrumbProps,
	...children: Child[]
) {
	return Nav(
		{ "aria-label": "breadcrumb", ...props, "data-slot": "breadcrumb", class: className },
		...children,
	);
});

export const BreadcrumbList = createComponent(function BreadcrumbList(
	{ class: className, ...props }: BreadcrumbListProps,
	...children: Child[]
) {
	return Ol(
		{
			...props,
			"data-slot": "breadcrumb-list",
			class: cn(
				"flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5",
				className,
			),
		},
		...children,
	);
});

export const BreadcrumbItem = createComponent(function BreadcrumbItem(
	{ class: className, ...props }: BreadcrumbItemProps,
	...children: Child[]
) {
	return Li(
		{
			...props,
			"data-slot": "breadcrumb-item",
			class: cn("inline-flex items-center gap-1.5", className),
		},
		...children,
	);
});

export const BreadcrumbLink = createComponent(function BreadcrumbLink(
	{ class: className, ...props }: BreadcrumbLinkProps,
	...children: Child[]
) {
	return A(
		{
			...props,
			"data-slot": "breadcrumb-link",
			class: cn("transition-colors hover:text-foreground", className),
		},
		...children,
	);
});

/** The crumb for the current page: not a link, and marked as current. */
export const BreadcrumbPage = createComponent(function BreadcrumbPage(
	{ class: className, ...props }: BreadcrumbPageProps,
	...children: Child[]
) {
	return Span(
		{
			role: "link",
			"aria-disabled": true,
			"aria-current": "page",
			...props,
			"data-slot": "breadcrumb-page",
			class: cn("font-normal text-foreground", className),
		},
		...children,
	);
});

/**
 * The mark between crumbs. It is `aria-hidden` and presentational — the list
 * structure already says these are steps, so announcing a chevron each time
 * would only be noise. Pass children to use something other than a chevron.
 */
export const BreadcrumbSeparator = createComponent(function BreadcrumbSeparator(
	{ class: className, ...props }: BreadcrumbSeparatorProps,
	...children: Child[]
) {
	return Li(
		{
			role: "presentation",
			"aria-hidden": true,
			...props,
			"data-slot": "breadcrumb-separator",
			class: cn("inline-flex items-center [&>svg]:size-3.5", className),
		},
		...(children.length > 0 ? children : [ChevronRightIcon()]),
	);
});

/** A stand-in for crumbs that have been collapsed away. */
export const BreadcrumbEllipsis = createComponent(function BreadcrumbEllipsis(
	{ class: className, ...props }: BreadcrumbEllipsisProps,
	...children: Child[]
) {
	return Span(
		{
			role: "presentation",
			"aria-hidden": true,
			...props,
			"data-slot": "breadcrumb-ellipsis",
			class: cn("flex size-9 items-center justify-center", className),
		},
		...children,
		EllipsisIcon({ class: "size-4" }),
		Span({ class: "sr-only" }, "More"),
	);
});
