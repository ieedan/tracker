import { Div, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { cn } from "../../utils";

export type SkeletonProps = ElementProps<"div">;

/**
 * A shape standing in for content that has not arrived. Size it with the
 * classes the real content will have, so the swap does not move the layout.
 */
export const Skeleton = createComponent(function Skeleton(
	{ class: className, ...props }: SkeletonProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "skeleton",
			class: cn("animate-pulse rounded-md bg-accent motion-reduce:animate-none", className),
		},
		...children,
	);
});
