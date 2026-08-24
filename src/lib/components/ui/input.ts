import { Input as InputElement, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "../../utils";

export const inputVariants = tv({
	base: [
		"flex h-8 w-full min-w-0 rounded-md text-base transition-[color,box-shadow] outline-none md:text-sm",
		"placeholder:text-muted-foreground",
		"selection:bg-primary selection:text-primary-foreground",
		"file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
		"disabled:cursor-not-allowed disabled:opacity-50",
		"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
	],
	variants: {
		variant: {
			default: [
				"border border-input bg-transparent px-3 py-1 shadow-xs",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"dark:bg-input/30",
			],
			borderless: [
				"border-none bg-transparent px-0 shadow-none dark:bg-transparent h-auto",
				"focus-visible:border-none focus-visible:ring-0",
			],
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

export type InputVariant = VariantProps<typeof inputVariants>["variant"];

export type InputProps = ElementProps<"input"> & VariantProps<typeof inputVariants>;

/**
 * A text field. Every prop goes through to the `input`, so `type`, `value`,
 * `placeholder`, and the rest work as they always do — this only dresses it.
 *
 * `aria-invalid` is styled as well as announced, which is how `FieldError`
 * marks the control it belongs to.
 */
export const Input = createComponent(function Input({
	class: className,
	variant = "default",
	...props
}: InputProps) {
	return InputElement({
		...props,
		"data-slot": "input",
		"data-variant": variant,
		class: cn(inputVariants({ variant }), className),
	});
});
