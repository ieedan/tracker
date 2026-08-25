import { type Child, type ComponentProps } from "@implementjs/core";
import { AspectRatio as AspectRatioPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";

export type AspectRatioProps = ComponentProps<typeof AspectRatioPrimitive>;

export const AspectRatio = createComponent(function AspectRatio(
	props: AspectRatioProps,
	...children: Child[]
) {
	return AspectRatioPrimitive({ "data-slot": "aspect-ratio", ...props }, ...children);
});
