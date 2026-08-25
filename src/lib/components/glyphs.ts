import { derived, Div, Dynamic, Span, Svg, type Readable } from "@implementjs/core";
import type { IssuePriority, IssueStatus } from "@/lib/domain/issues";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/domain/issues";
import { cn } from "@/lib/utils";

/**
 * One glyph size for every inline chip — a picker trigger, a filter pill, a
 * composer chip.
 *
 * The glyphs disagree by default: the status ring is a 16px box around a 14px
 * SVG, the priority bars are a 16px column, an avatar is 20px, and the lucide
 * icons are 14px. Side by side in a row of chips that reads as five different
 * controls rather than one row.
 *
 * `cn` runs these through tailwind-merge, so a `size-*` here beats the one baked
 * into the glyph. Two need more than that: the status ring carries width/height
 * attributes on its markup, which only the `[&_svg]:` variant overrides, and the
 * priority bars are a column of fixed heights rather than one box, so the column
 * is resized and centred inside the same square as everything else.
 */
export const CHIP_GLYPH = {
	status: "size-3.5 [&_svg]:size-3.5",
	priority: "size-3.5 justify-center [&>div]:h-3.5",
	avatar: "size-3.5 text-[8px]",
	dot: "size-2",
	icon: "size-3.5",
} as const;

const STATUS_COLOR: Record<IssueStatus, string> = {
	backlog: "#8a8f98",
	todo: "#8a8f98",
	in_progress: "#f2c94c",
	done: "#5e6ad2",
	canceled: "#6b6f76",
};

/**
 * Linear draws status as a ring that fills as work progresses, rather than as
 * five unrelated icons. One SVG with a variable arc keeps that reading.
 */
function statusMarkup(status: IssueStatus): string {
	const color = STATUS_COLOR[status];
	const ring = `<circle cx="8" cy="8" r="6.4" fill="none" stroke="${color}" stroke-width="1.6"`;

	switch (status) {
		case "backlog":
			return `<svg viewBox="0 0 16 16" width="14" height="14">${ring} stroke-dasharray="2.2 2.2"/></svg>`;
		case "todo":
			return `<svg viewBox="0 0 16 16" width="14" height="14">${ring}/></svg>`;
		case "in_progress":
			// A half-filled dial: the ring plus a 180° wedge drawn from the centre.
			return `<svg viewBox="0 0 16 16" width="14" height="14">${ring}/><path d="M8 8 L8 3.2 A4.8 4.8 0 0 1 8 12.8 Z" fill="${color}"/></svg>`;
		case "done":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7.2" fill="${color}"/><path d="M4.8 8.2 L7 10.4 L11.2 5.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		case "canceled":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7.2" fill="${color}"/><path d="M5.4 5.4 L10.6 10.6 M10.6 5.4 L5.4 10.6" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>`;
	}
}

export function StatusIcon(status: IssueStatus | Readable<IssueStatus>, className?: string) {
	const source =
		typeof status === "string"
			? statusMarkup(status)
			: derived([status], (current) => statusMarkup(current));

	return Span(
		{
			class: cn("inline-flex size-4 shrink-0 items-center justify-center", className),
			title: typeof status === "string" ? STATUS_LABELS[status] : undefined,
			"aria-hidden": "true",
		},
		Svg(source),
	);
}

const PRIORITY_BARS: Record<IssuePriority, number> = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
	urgent: 3,
};

/**
 * Three ascending bars, lit up to the issue's level — Linear's priority glyph.
 * Urgent is the exception: it gets a filled block instead of bars.
 */
export function PriorityIcon(
	priority: IssuePriority | Readable<IssuePriority>,
	className?: string,
) {
	const render = (current: IssuePriority) => {
		if (current === "urgent") {
			return Div(
				{ class: "flex size-4 items-center justify-center rounded-[3px] bg-[#f2994a]" },
				Span({ class: "text-[10px] font-bold leading-none text-black" }, "!"),
			);
		}

		const lit = PRIORITY_BARS[current];
		const heights = ["h-1.5", "h-2.5", "h-3.5"];
		return Div(
			{ class: "flex h-4 items-end gap-[2px]" },
			...heights.map((height, index) =>
				Div({
					class: cn(
						"w-[3px] rounded-[1px]",
						height,
						index < lit ? "bg-foreground/80" : "bg-muted-foreground/30",
					),
				}),
			),
		);
	};

	if (typeof priority === "string") {
		return Span(
			{
				class: cn("inline-flex shrink-0 items-center", className),
				title: PRIORITY_LABELS[priority],
			},
			render(priority),
		);
	}

	// A signal of a priority swaps the whole glyph, so the bars re-light in place.
	return Span(
		{ class: cn("inline-flex shrink-0 items-center", className) },
		Dynamic([priority], (current) => render(current)),
	);
}

const AVATAR_COLORS = [
	"#5e6ad2",
	"#26a69a",
	"#e5484d",
	"#f2994a",
	"#9b51e0",
	"#2d9cdb",
	"#27ae60",
	"#eb5757",
];

/** Stable per-user colour, so the same person is the same colour everywhere. */
export function avatarColor(id: string): string {
	let hash = 0;
	for (let index = 0; index < id.length; index++) {
		hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
	}
	return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
	return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export interface AvatarUser {
	id: string;
	name: string;
	image?: string | null;
}

export function UserAvatar(user: AvatarUser, className?: string) {
	return Span(
		{
			class: cn(
				"inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white select-none",
				className,
			),
			style: { backgroundColor: avatarColor(user.id) },
			title: user.name,
		},
		initialsOf(user.name),
	);
}

/** The dashed ring Linear shows where an assignee would go. */
export function UnassignedAvatar(className?: string) {
	return Span({
		class: cn(
			"inline-block size-5 shrink-0 rounded-full border border-dashed border-muted-foreground/60",
			className,
		),
		title: "Unassigned",
	});
}
