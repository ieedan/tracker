import { derived, Div, signal, type ComponentProps } from "@implementjs/core";
import { Meter as MeterPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type MeterProps = ComponentProps<typeof MeterPrimitive>;

export const Meter = createComponent(function Meter({
	class: className,
	value = 0,
	min = 0,
	max = 100,
	...props
}: MeterProps) {
	const valueSignal = signal(value);
	const minSignal = signal(min);
	const maxSignal = signal(max);

	const percent = derived([valueSignal, minSignal, maxSignal], (value, min, max) => {
		if (max === min) return 0;
		return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
	});

	return MeterPrimitive(
		{
			value: valueSignal,
			min: minSignal,
			max: maxSignal,
			...props,
			"data-slot": "meter",
			class: cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className),
		},
		Div({
			"data-slot": "meter-indicator",
			class: "size-full flex-1 bg-primary transition-transform",
			style: { transform: percent.bind((p) => `translateX(-${100 - p}%)`) },
		}),
	);
});
