import {
	derived,
	Div,
	isReadable,
	signal,
	type ComponentProps,
	type Readable,
} from "@implementjs/core";
import { Progress as ProgressPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type ProgressProps = ComponentProps<typeof ProgressPrimitive>;

/** The props are read here, so anything readable is kept and a plain number gets a signal to sit in. */
function readable<T>(value: T | Readable<T>): Readable<T> {
	return isReadable(value) ? value : signal(value);
}

export const Progress = createComponent(function Progress({
	class: className,
	value = 0,
	min = 0,
	max = 100,
	...props
}: ProgressProps) {
	const currentValue = readable(value);
	const minValue = readable(min);
	const maxValue = readable(max);

	// An indeterminate bar shows a full-width pulsing fill instead of a position.
	const percent = derived([currentValue, minValue, maxValue], (value, min, max) => {
		if (value === null || max === min) return 100;
		return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
	});

	return ProgressPrimitive(
		{
			value: currentValue,
			min: minValue,
			max: maxValue,
			...props,
			"data-slot": "progress",
			class: cn(
				"group/progress relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
				className,
			),
		},
		Div({
			"data-slot": "progress-indicator",
			class:
				"size-full flex-1 bg-primary transition-transform group-data-[indeterminate]/progress:animate-pulse",
			style: { transform: percent.bind((p) => `translateX(-${100 - p}%)`) },
		}),
	);
});
