import { Span, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "@/lib/utils";

export const badgeVariants = tv({
	base: "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
	variants: {
		variant: {
			default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
			secondary:
				"border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
			destructive:
				"border-transparent bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
			outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
		},
	},
	defaultVariants: { variant: "default" },
});

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

export type BadgeProps = ElementProps<"span"> & VariantProps<typeof badgeVariants>;

/**
 * A small status marker. It renders a `Span`; for a badge that navigates,
 * put `badgeVariants()` on an `A` instead — the hover rules are written
 * against `[a&]`, so they only apply once the badge really is a link.
 */
export const Badge = createComponent(function Badge(
	{ class: className, variant = "default", ...props }: BadgeProps,
	...children: Child[]
) {
	return Span(
		{
			...props,
			"data-slot": "badge",
			"data-variant": variant,
			class: cn(badgeVariants({ variant }), className),
		},
		...children,
	);
});
