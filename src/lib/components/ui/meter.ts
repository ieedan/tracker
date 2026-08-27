import {
	derived,
	Div,
	isReadable,
	signal,
	type ComponentProps,
	type Readable,
} from "@implementjs/core";
import { Meter as MeterPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type MeterProps = ComponentProps<typeof MeterPrimitive>;

/** The props are read here, so anything readable is kept and a plain number gets a signal to sit in. */
function readable<T>(value: T | Readable<T>): Readable<T> {
	return isReadable(value) ? value : signal(value);
}

export const Meter = createComponent(function Meter({
	class: className,
	value = 0,
	min = 0,
	max = 100,
	...props
}: MeterProps) {
	const currentValue = readable(value);
	const minValue = readable(min);
	const maxValue = readable(max);

	const percent = derived([currentValue, minValue, maxValue], (value, min, max) => {
		if (max === min) return 0;
		return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
	});

	return MeterPrimitive(
		{
			value: currentValue,
			min: minValue,
			max: maxValue,
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
