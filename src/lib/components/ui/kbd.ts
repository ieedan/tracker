import { Kbd as KbdElement, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type KbdProps = ElementProps<"kbd">;
export type KbdGroupProps = ElementProps<"kbd">;

/** One key on a keyboard, for documenting a shortcut. */
export const Kbd = createComponent(function Kbd(
	{ class: className, ...props }: KbdProps,
	...children: Child[]
) {
	return KbdElement(
		{
			...props,
			"data-slot": "kbd",
			class: cn(
				"inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1",
				"font-sans text-[0.7rem] font-medium text-muted-foreground select-none",
				"[&_svg:not([class*='size-'])]:size-3",
				"[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
				className,
			),
		},
		...children,
	);
});

/** A chord or a sequence: several keys read as one shortcut. */
export const KbdGroup = createComponent(function KbdGroup(
	{ class: className, ...props }: KbdGroupProps,
	...children: Child[]
) {
	return KbdElement(
		{
			...props,
			"data-slot": "kbd-group",
			class: cn("inline-flex items-center gap-1", className),
		},
		...children,
	);
});
