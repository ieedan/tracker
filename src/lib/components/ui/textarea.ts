import { Textarea as TextareaElement, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "../../utils";

export const textareaVariants = tv({
	base: [
		"flex field-sizing-content min-h-16 w-full rounded-md text-base transition-[color,box-shadow] outline-none md:text-sm",
		"placeholder:text-muted-foreground",
		"disabled:cursor-not-allowed disabled:opacity-50",
		"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
	],
	variants: {
		variant: {
			default: [
				"border border-input bg-transparent px-3 py-2 shadow-xs",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"dark:bg-input/30",
			],
			borderless: [
				"border-none bg-transparent px-0 shadow-none dark:bg-transparent resize-none",
				"focus-visible:border-none focus-visible:ring-0",
			],
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

export type TextareaVariant = VariantProps<typeof textareaVariants>["variant"];

export type TextareaProps = ElementProps<"textarea"> & VariantProps<typeof textareaVariants>;

/**
 * A multi-line field, styled to match [Input](/ui/input). `field-sizing-content`
 * grows it with what is typed where the browser supports it, between the min
 * height here and whatever `max-h-*` you add.
 */
export const Textarea = createComponent(function Textarea(
	{ class: className, variant = "default", ...props }: TextareaProps,
	...children: Child[]
) {
	return TextareaElement(
		{
			...props,
			"data-slot": "textarea",
			"data-variant": variant,
			class: cn(textareaVariants({ variant }), className),
		},
		...children,
	);
});
