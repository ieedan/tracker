import { Textarea as TextareaElement, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type TextareaProps = ElementProps<"textarea">;

/**
 * A multi-line field, styled to match [Input](/ui/input). `field-sizing-content`
 * grows it with what is typed where the browser supports it, between the min
 * height here and whatever `max-h-*` you add.
 */
export const Textarea = createComponent(function Textarea(
	{ class: className, ...props }: TextareaProps,
	...children: Child[]
) {
	return TextareaElement(
		{
			...props,
			"data-slot": "textarea",
			class: cn(
				"flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm",
				"placeholder:text-muted-foreground",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"dark:bg-input/30",
				className,
			),
		},
		...children,
	);
});
