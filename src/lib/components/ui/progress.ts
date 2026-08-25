import { derived, Div, signal, type ComponentProps } from "@implementjs/core";
import { Progress as ProgressPrimitive } from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type ProgressProps = ComponentProps<typeof ProgressPrimitive>;

export const Progress = createComponent(function Progress({
	class: className,
	value = 0,
	min = 0,
	max = 100,
	...props
}: ProgressProps) {
	const valueSignal = signal(value);
	const minSignal = signal(min);
	const maxSignal = signal(max);

	// An indeterminate bar shows a full-width pulsing fill instead of a position.
	const percent = derived([valueSignal, minSignal, maxSignal], (value, min, max) => {
		if (value === null || max === min) return 100;
		return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
	});

	return ProgressPrimitive(
		{
			value: valueSignal,
			min: minSignal,
			max: maxSignal,
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
