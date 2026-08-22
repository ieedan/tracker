import { Svg, type Readable } from "@implementjs/core";
import { type Priority, PRIORITY_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Three ascending bars, filled to the priority — the same shorthand Linear
 * uses. "No priority" is a dotted line rather than empty bars, so it is
 * distinguishable from "Low" at a glance.
 */

const HEIGHTS = [4, 7, 10];

function markup(priority: Priority): string {
	if (priority === 0) {
		return `<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2" y="7.4" width="3" height="1.6" rx="0.8" fill="currentColor" opacity="0.5" />
			<rect x="6.5" y="7.4" width="3" height="1.6" rx="0.8" fill="currentColor" opacity="0.5" />
			<rect x="11" y="7.4" width="3" height="1.6" rx="0.8" fill="currentColor" opacity="0.5" />
		</svg>`;
	}

	if (priority === 1) {
		return `<svg viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" />
			<rect x="7.2" y="4.4" width="1.6" height="5" rx="0.8" fill="var(--color-background)" />
			<rect x="7.2" y="10.6" width="1.6" height="1.6" rx="0.8" fill="var(--color-background)" />
		</svg>`;
	}

	// 2 = High fills three bars, 3 = Medium two, 4 = Low one.
	const filled = 5 - priority;

	return `<svg viewBox="0 0 16 16" aria-hidden="true">${HEIGHTS.map((height, index) => {
		const x = 2 + index * 4.5;
		const opacity = index < filled ? "1" : "0.28";
		return `<rect x="${x}" y="${13 - height}" width="3" height="${height}" rx="1"
			fill="currentColor" opacity="${opacity}" />`;
	}).join("")}</svg>`;
}

/** The reactive form, for a row whose priority can change under it. */
export function ReactivePriorityIcon(priority: Readable<Priority>, className?: string) {
	return Svg(priority.bind(markup), {
		class: cn(
			"size-4 shrink-0",
			priority.bind((value) => (value === 1 ? "text-orange-500" : "text-muted-foreground")),
			className,
		),
		role: "img",
		"aria-label": priority.bind((value) => PRIORITY_LABELS[value]),
	});
}

export function PriorityIcon(priority: Priority, className?: string) {
	return Svg(markup(priority), {
		class: cn("size-4 shrink-0", priority === 1 ? "text-orange-500" : "text-muted-foreground", className),
		role: "img",
		"aria-label": PRIORITY_LABELS[priority],
	});
}
