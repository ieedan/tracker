import { Div, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "@/lib/utils";

export const alertVariants = tv({
	base: "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
	variants: {
		variant: {
			default: "bg-card text-card-foreground",
			destructive: "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90",
		},
	},
	defaultVariants: { variant: "default" },
});

export type AlertVariant = VariantProps<typeof alertVariants>["variant"];

export type AlertProps = ElementProps<"div"> & VariantProps<typeof alertVariants>;
export type AlertTitleProps = ElementProps<"div">;
export type AlertDescriptionProps = ElementProps<"div">;

/**
 * A standing message about the page — not a [toast](/ui/toast), which passes,
 * and not a [dialog](/ui/dialog), which interrupts.
 *
 * The grid gains its icon column only when an icon is actually present
 * (`has-[>svg]`), so a text-only alert has no empty gutter to explain.
 */
export const Alert = createComponent(function Alert(
	{ class: className, variant = "default", ...props }: AlertProps,
	...children: Child[]
) {
	return Div(
		{
			role: "alert",
			...props,
			"data-slot": "alert",
			"data-variant": variant,
			class: cn(alertVariants({ variant }), className),
		},
		...children,
	);
});

export const AlertTitle = createComponent(function AlertTitle(
	{ class: className, ...props }: AlertTitleProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "alert-title",
			class: cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className),
		},
		...children,
	);
});

export const AlertDescription = createComponent(function AlertDescription(
	{ class: className, ...props }: AlertDescriptionProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "alert-description",
			class: cn(
				"col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
				className,
			),
		},
		...children,
	);
});
