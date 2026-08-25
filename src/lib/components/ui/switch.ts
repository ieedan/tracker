import { type Child, type ComponentProps } from "@implementjs/core";
import {
	Switch as SwitchPrimitive,
	SwitchThumb as SwitchThumbPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type SwitchProps = ComponentProps<typeof SwitchPrimitive>;
export type SwitchThumbProps = ComponentProps<typeof SwitchThumbPrimitive>;

export const Switch = createComponent(function Switch(
	{ class: className, ...props }: SwitchProps,
	...children: Child[]
) {
	return SwitchPrimitive(
		{
			...props,
			"data-slot": "switch",
			class: cn(
				"peer group/switch inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-all",
				"data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
				"dark:data-[state=unchecked]:bg-input/80",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			),
		},
		...(children.length > 0 ? children : [SwitchThumb({})]),
	);
});

export const SwitchThumb = createComponent(function SwitchThumb(
	{ class: className, ...props }: SwitchThumbProps,
	...children: Child[]
) {
	return SwitchThumbPrimitive(
		{
			...props,
			"data-slot": "switch-thumb",
			class: cn(
				"pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform",
				"data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
				"dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground",
				className,
			),
		},
		...children,
	);
});
