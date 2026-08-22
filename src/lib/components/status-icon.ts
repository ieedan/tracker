import { Svg, type Readable } from "@implementjs/core";
import type { StatusCategory, StatusDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Linear's status glyphs: a ring that fills as work progresses. Drawn inline
 * rather than pulled from an icon set because the fill fraction and the colour
 * both come from the status itself.
 */

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** How much of the ring each category fills. */
const FILL: Record<StatusCategory, number> = {
	backlog: 0,
	unstarted: 0,
	started: 0.55,
	completed: 1,
	canceled: 1,
};

function markup(category: StatusCategory, color: string): string {
	const stroke = `stroke="${color}"`;

	if (category === "completed") {
		return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="7" fill="${color}" />
			<path d="M4.6 8.2 7 10.6l4.2-4.6" stroke="var(--color-background)" stroke-width="1.8"
				stroke-linecap="round" stroke-linejoin="round" fill="none" />
		</svg>`;
	}

	if (category === "canceled") {
		return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="7" fill="${color}" />
			<path d="M5.6 5.6 10.4 10.4M10.4 5.6 5.6 10.4" stroke="var(--color-background)"
				stroke-width="1.8" stroke-linecap="round" fill="none" />
		</svg>`;
	}

	// Backlog is the only dashed ring — it reads as "not really on the board yet".
	const dash = category === "backlog" ? ` stroke-dasharray="2.2 2.2"` : "";
	const filled = FILL[category];

	const progress =
		filled === 0
			? ""
			: `<circle cx="8" cy="8" r="${RADIUS / 2}" fill="none" ${stroke} stroke-width="${RADIUS}"
					stroke-dasharray="${CIRCUMFERENCE / 2}" stroke-dashoffset="${(CIRCUMFERENCE / 2) * (1 - filled)}"
					transform="rotate(-90 8 8)" />`;

	return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<circle cx="8" cy="8" r="${RADIUS}" ${stroke} stroke-width="1.6"${dash} fill="none" />
		${progress}
	</svg>`;
}

export function StatusIcon(status: StatusDto, className?: string) {
	return Svg(markup(status.category, status.color), {
		class: cn("size-4 shrink-0", className),
	});
}

/** A neutral ring, for "no status chosen yet". */
const EMPTY = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
	<circle cx="8" cy="8" r="${RADIUS}" stroke="currentColor" stroke-width="1.6"
		stroke-dasharray="2.2 2.2" opacity="0.4" fill="none" />
</svg>`;

/**
 * The reactive form, for a row whose status can change under it. Accepts null
 * so it can sit in a select trigger with nothing selected.
 */
export function ReactiveStatusIcon(status: Readable<StatusDto | null>, className?: string) {
	return Svg(
		status.bind((value) => (value === null ? EMPTY : markup(value.category, value.color))),
		{ class: cn("size-4 shrink-0", className) },
	);
}
