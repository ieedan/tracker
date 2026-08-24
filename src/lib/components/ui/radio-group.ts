import { Span, type Child, type ComponentProps } from "@implementjs/core";
import { CircleIcon } from "@implementjs/lucide";
import {
	RadioGroup as RadioGroupPrimitive,
	RadioGroupItem as RadioGroupItemPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type RadioGroupProps = ComponentProps<typeof RadioGroupPrimitive>;
export type RadioGroupItemProps = ComponentProps<typeof RadioGroupItemPrimitive>;

export const RadioGroup = createComponent(function RadioGroup(
	{ class: className, ...props }: RadioGroupProps,
	...children: Child[]
) {
	return RadioGroupPrimitive(
		{ ...props, "data-slot": "radio-group", class: cn("grid gap-3", className) },
		...children,
	);
});

export const RadioGroupItem = createComponent(function RadioGroupItem(
	{ class: className, ...props }: RadioGroupItemProps,
	...children: Child[]
) {
	return RadioGroupItemPrimitive(
		{
			...props,
			"data-slot": "radio-group-item",
			class: cn(
				"group/radio-item aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none",
				"dark:bg-input/30",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"data-[state=checked]:border-primary",
				className,
			),
		},
		...(children.length > 0
			? children
			: [
					Span(
						{
							"data-slot": "radio-group-indicator",
							class:
								"relative hidden size-full items-center justify-center group-data-[state=checked]/radio-item:flex",
						},
						CircleIcon({
							"aria-hidden": true,
							class:
								"absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary text-primary",
						}),
					),
				]),
	);
});
