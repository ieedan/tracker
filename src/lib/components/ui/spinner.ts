import type { SvgProps } from "@implementjs/core";
import { LoaderCircleIcon } from "@implementjs/lucide";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type SpinnerProps = SvgProps;

/**
 * A turning ring for work in flight. It carries `role="status"` and a label,
 * so a screen reader announces the wait — pass `aria-label` to say what for.
 */
export const Spinner = createComponent(function Spinner({
	class: className,
	...props
}: SpinnerProps) {
	return LoaderCircleIcon({
		role: "status",
		"aria-label": "Loading",
		...props,
		"data-slot": "spinner",
		class: cn("size-4 animate-spin motion-reduce:animate-none", className),
	});
});
