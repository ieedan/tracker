import { Label as LabelElement, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { cn } from "../../utils";

export type LabelProps = ElementProps<"label">;

/**
 * A label for a control. Point it at one with `for`; the primitives render
 * buttons rather than inputs, so `for` and `id` are how they pair up.
 *
 * It dims alongside a disabled control in two ways: `peer-disabled` for a
 * sibling marked `peer`, and `group-data-[disabled=true]` for a wrapper
 * marked `group` — which is what `Field` uses.
 */
export const Label = createComponent(function Label(
	{ class: className, ...props }: LabelProps,
	...children: Child[]
) {
	return LabelElement(
		{
			...props,
			"data-slot": "label",
			class: cn(
				"flex items-center gap-2 text-sm leading-none font-medium select-none",
				"peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
				"group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
				className,
			),
		},
		...children,
	);
});
