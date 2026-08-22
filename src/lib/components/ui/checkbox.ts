import { Span, type Child, type ComponentProps } from "@implementjs/core";
import { CheckIcon, MinusIcon } from "@implementjs/lucide";
import { Checkbox as CheckboxPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "../../utils";

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive>;

export const Checkbox = createComponent(function Checkbox(
	{ class: className, ...props }: CheckboxProps,
	...children: Child[]
) {
	return CheckboxPrimitive(
		{
			...props,
			"data-slot": "checkbox",
			class: cn(
				"peer group/checkbox size-4 shrink-0 rounded-[4px] border border-input shadow-xs outline-none transition-shadow",
				"dark:bg-input/30",
				"data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
				"data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
				"dark:data-[state=checked]:bg-primary dark:data-[state=indeterminate]:bg-primary",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			),
		},
		...(children.length > 0
			? children
			: [
					Span(
						{
							"data-slot": "checkbox-indicator",
							class: "grid place-content-center text-current",
						},
						CheckIcon({
							class: "size-3.5 hidden group-data-[state=checked]/checkbox:block",
							"aria-hidden": true,
						}),
						MinusIcon({
							class: "size-3.5 hidden group-data-[state=indeterminate]/checkbox:block",
							"aria-hidden": true,
						}),
					),
				]),
	);
});
