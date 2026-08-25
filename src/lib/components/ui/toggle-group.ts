import { type Child, type ComponentProps } from "@implementjs/core";
import {
	ToggleGroup as ToggleGroupPrimitive,
	ToggleGroupItem as ToggleGroupItemPrimitive,
} from "@implementjs/primitives";
import { toggleVariants, type ToggleSize, type ToggleVariant } from "./toggle";
import { cn } from "@/lib/utils";
import { createComponent } from "@implementjs/primitives";

export type ToggleGroupProps = ComponentProps<typeof ToggleGroupPrimitive>;
export type ToggleGroupItemProps = ComponentProps<typeof ToggleGroupItemPrimitive> & {
	variant?: ToggleVariant;
	size?: ToggleSize;
};

export const ToggleGroup = createComponent(function ToggleGroup(
	{ class: className, ...props }: ToggleGroupProps,
	...children: Child[]
) {
	return ToggleGroupPrimitive(
		{
			...props,
			"data-slot": "toggle-group",
			class: cn("flex w-fit items-center rounded-md", className),
		},
		...children,
	);
});

export const ToggleGroupItem = createComponent(function ToggleGroupItem(
	{ class: className, variant = "default", size = "default", ...props }: ToggleGroupItemProps,
	...children: Child[]
) {
	return ToggleGroupItemPrimitive(
		{
			...props,
			"data-slot": "toggle-group-item",
			"data-variant": variant,
			"data-size": size,
			class: cn(
				toggleVariants({ variant, size }),
				"min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10",
				"data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
				className,
			),
		},
		...children,
	);
});
