/**
 * Feedback's own glyph, kept apart from the issue one on purpose.
 *
 * An issue's status ring says how far the work has got. A piece of feedback has
 * not been started or finished — it has been read, or agreed to, or turned
 * down. Reusing the ring would say something untrue at a glance, so this is a
 * dot that changes color and fills as it is decided.
 */
import { derived, Span, Svg, type Readable } from "@implementjs/core";
import { FEEDBACK_STATUS_LABELS, type FeedbackStatus } from "@/lib/domain/feedback";
import { cn } from "@/lib/utils";

const COLOR: Record<FeedbackStatus, string> = {
	new: "#2d9cdb",
	reviewing: "#f2c94c",
	// Agreed and scheduled are one phase at two degrees of commitment, so they
	// share a hue; the ring is what tells them apart.
	accepted: "#9b51e0",
	planned: "#9b51e0",
	in_progress: "#f2994a",
	done: "#27ae60",
	declined: "#6b6f76",
};

function markup(status: FeedbackStatus): string {
	const color = COLOR[status];
	switch (status) {
		case "new":
			// Solid: unread, the one that should catch the eye.
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5" fill="${color}"/></svg>`;
		case "reviewing":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="${color}" stroke-width="1.8"/><circle cx="8" cy="8" r="2" fill="${color}"/></svg>`;
		case "accepted":
			// Agreed to, nothing started: the tick outlined rather than filled, so
			// it reads as a promise made and not yet a promise kept.
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="${color}" stroke-width="1.8"/><path d="M5.3 8.1 L7.1 9.9 L10.7 6.1" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		case "planned":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="2.4 2"/></svg>`;
		case "in_progress":
			// Half filled, the way the issue ring fills as work moves — this is the
			// one status that is about work rather than about a decision.
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="${color}" stroke-width="1.8"/><path d="M8 3.6 A4.4 4.4 0 0 1 8 12.4 Z" fill="${color}"/></svg>`;
		case "done":
			// Filled and ticked: the only status that says the thing they asked for
			// exists now.
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="${color}"/><path d="M4.9 8.2 L7 10.3 L11.1 5.9" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		case "declined":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="${color}" stroke-width="1.8"/><path d="M5.4 8 L10.6 8" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
	}
}

export function FeedbackStatusIcon(
	status: FeedbackStatus | Readable<FeedbackStatus>,
	className?: string,
) {
	const source =
		typeof status === "string" ? markup(status) : derived([status], (value) => markup(value));

	return Span(
		{
			class: cn("inline-flex size-4 shrink-0 items-center justify-center", className),
			title: typeof status === "string" ? FEEDBACK_STATUS_LABELS[status] : undefined,
			"aria-hidden": "true",
		},
		Svg(source),
	);
}
