import type { ComponentProps } from "@implementjs/core";
import { Separator as SeparatorPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "../../utils";

export type SeparatorProps = ComponentProps<typeof SeparatorPrimitive>;

export const Separator = createComponent(function Separator({
	class: className,
	orientation = "horizontal",
	decorative = true,
	...props
}: SeparatorProps) {
	return SeparatorPrimitive({
		...props,
		orientation,
		decorative,
		"data-slot": "separator",
		class: cn(
			"shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
			className,
		),
	});
});
