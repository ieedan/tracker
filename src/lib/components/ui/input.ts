import { Input as InputElement, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { cn } from "../../utils";

export type InputProps = ElementProps<"input">;

/**
 * A text field. Every prop goes through to the `input`, so `type`, `value`,
 * `placeholder`, and the rest work as they always do — this only dresses it.
 *
 * `aria-invalid` is styled as well as announced, which is how `FieldError`
 * marks the control it belongs to.
 */
export const Input = createComponent(function Input({ class: className, ...props }: InputProps) {
	return InputElement({
		...props,
		"data-slot": "input",
		class: cn(
			"flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm",
			"placeholder:text-muted-foreground",
			"selection:bg-primary selection:text-primary-foreground",
			"file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
			"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
			"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
			"disabled:cursor-not-allowed disabled:opacity-50",
			"dark:bg-input/30",
			className,
		),
	});
});
