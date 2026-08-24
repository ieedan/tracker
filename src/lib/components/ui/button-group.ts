import { Div, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { Separator } from "./separator";
import { cn } from "@/lib/utils";

export const buttonGroupVariants = tv({
	base: [
		"flex w-fit items-stretch",
		"[&>*]:focus-visible:z-10 [&>*]:focus-visible:relative",
		"[&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit",
		"[&>input]:flex-1",
		"has-[>[data-slot=button-group]]:gap-2",
	],
	variants: {
		orientation: {
			horizontal:
				"[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
			vertical:
				"flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none",
		},
	},
	defaultVariants: { orientation: "horizontal" },
});

export type ButtonGroupOrientation = VariantProps<typeof buttonGroupVariants>["orientation"];

export type ButtonGroupProps = ElementProps<"div"> & VariantProps<typeof buttonGroupVariants>;
export type ButtonGroupTextProps = ElementProps<"div">;
export type ButtonGroupSeparatorProps = ElementProps<"div">;

/**
 * Buttons joined into one control. The group squares off the inner corners
 * and drops the doubled borders between children, so a row of outline
 * buttons reads as a single segmented thing rather than as several.
 *
 * It styles whatever is inside by position, not by type — a
 * [select](/ui/select) trigger or an [input](/ui/input) joins the row on the
 * same terms as a button.
 */
export const ButtonGroup = createComponent(function ButtonGroup(
	{ class: className, orientation = "horizontal", ...props }: ButtonGroupProps,
	...children: Child[]
) {
	return Div(
		{
			role: "group",
			...props,
			"data-slot": "button-group",
			"data-orientation": orientation,
			class: cn(buttonGroupVariants({ orientation }), className),
		},
		...children,
	);
});

/** A non-interactive label sitting in the row, styled like a button. */
export const ButtonGroupText = createComponent(function ButtonGroupText(
	{ class: className, ...props }: ButtonGroupTextProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "button-group-text",
			class: cn(
				"flex items-center gap-2 rounded-md border bg-muted px-4 text-sm font-medium shadow-xs",
				"[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
				className,
			),
		},
		...children,
	);
});

/**
 * A divider inside the group. The group removes the borders between
 * children, so this is how you put a visible line back where you want one.
 */
export const ButtonGroupSeparator = createComponent(function ButtonGroupSeparator({
	class: className,
	orientation = "vertical",
	...props
}: ButtonGroupSeparatorProps & { orientation?: "horizontal" | "vertical" }) {
	return Separator({
		...props,
		orientation,
		"data-slot": "button-group-separator",
		class: cn("relative !m-0 self-stretch bg-input data-[orientation=vertical]:h-auto", className),
	});
});
