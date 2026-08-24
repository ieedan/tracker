import { type Child, type ComponentProps } from "@implementjs/core";
import { Toggle as TogglePrimitive } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export const toggleVariants = tv({
	base: "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	variants: {
		variant: {
			default: "bg-transparent",
			outline:
				"border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
		},
		size: {
			default: "h-9 min-w-9 px-2",
			sm: "h-8 min-w-8 px-1.5",
			lg: "h-10 min-w-10 px-2.5",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

export type ToggleVariant = VariantProps<typeof toggleVariants>["variant"];
export type ToggleSize = VariantProps<typeof toggleVariants>["size"];

export type ToggleProps = ComponentProps<typeof TogglePrimitive> & {
	variant?: ToggleVariant;
	size?: ToggleSize;
};

export const Toggle = createComponent(function Toggle(
	{ class: className, variant = "default", size = "default", ...props }: ToggleProps,
	...children: Child[]
) {
	return TogglePrimitive(
		{
			...props,
			"data-slot": "toggle",
			"data-variant": variant,
			"data-size": size,
			class: cn(toggleVariants({ variant, size }), className),
		},
		...children,
	);
});
