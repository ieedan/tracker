import { derived, Div, Dynamic, Img, Span, Svg, type Readable } from "@implementjs/core";
import type { IssuePriority, IssueStatus } from "@/lib/domain/issues";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/domain/issues";
import type { HarnessKind, UserType } from "@/lib/domain/agents";
import { cn } from "@/lib/utils";
import { HarnessLogo } from "./harness-logo";

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
 * into the glyph. The status ring needs more than that: it carries width/height
 * attributes on its markup, which only the `[&_svg]:` variant overrides. The
 * priority glyph resizes on its own — it draws inside `PRIORITY_GLYPH_BOX`, and
 * both of its shapes are sized against that box rather than against content.
 */
export const CHIP_GLYPH = {
	status: "size-3.5 [&_svg]:size-3.5",
	priority: "size-3.5",
	avatar: "size-3.5 text-[8px]",
	dot: "size-2",
	icon: "size-3.5",
} as const;

/**
 * GitHub's mark.
 *
 * Hand-drawn rather than taken from lucide, whose `Github` icon is a simplified
 * outline — the real octocat silhouette is what people scan for on a sign-in
 * button, and a near-miss reads as a phishing page.
 */
export function GithubMark(props: { class?: string } = {}) {
	return Span(
		{ class: cn("inline-flex shrink-0 items-center justify-center", props.class) },
		Svg(
			`<svg viewBox="0 0 16 16" width="100%" height="100%" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
		),
	);
}

const STATUS_COLOR: Record<IssueStatus, string> = {
	backlog: "#8a8f98",
	todo: "#8a8f98",
	rework: "#f2994a",
	in_progress: "#f2c94c",
	in_review: "#4cb782",
	done: "#5e6ad2",
	canceled: "#6b6f76",
	duplicate: "#6b6f76",
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
		case "rework":
			// A quarter-filled dial: work has come back around, but not far.
			return `<svg viewBox="0 0 16 16" width="14" height="14">${ring}/><path d="M8 8 L8 3.2 A4.8 4.8 0 0 1 12.8 8 Z" fill="${color}"/></svg>`;
		case "in_progress":
			// A half-filled dial: the ring plus a 180° wedge drawn from the centre.
			return `<svg viewBox="0 0 16 16" width="14" height="14">${ring}/><path d="M8 8 L8 3.2 A4.8 4.8 0 0 1 8 12.8 Z" fill="${color}"/></svg>`;
		case "in_review":
			// A three-quarter-filled dial: nearly done, one pass from review left.
			return `<svg viewBox="0 0 16 16" width="14" height="14">${ring}/><path d="M8 8 L8 3.2 A4.8 4.8 0 1 1 3.2 8 Z" fill="${color}"/></svg>`;
		case "done":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7.2" fill="${color}"/><path d="M4.8 8.2 L7 10.4 L11.2 5.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		case "canceled":
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7.2" fill="${color}"/><path d="M5.4 5.4 L10.6 10.6 M10.6 5.4 L5.4 10.6" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>`;
		case "duplicate":
			// Two overlapping squares — the universal copy glyph — on a filled circle.
			return `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7.2" fill="${color}"/><rect x="4.6" y="6.2" width="5.6" height="5.6" rx="1" fill="none" stroke="#fff" stroke-width="1.3"/><rect x="6.6" y="4.2" width="5.6" height="5.6" rx="1" fill="none" stroke="#fff" stroke-width="1.3"/></svg>`;
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
 * The fixed square every priority glyph is drawn inside.
 *
 * The two glyphs are different shapes — three 3px bars with 2px gaps is a 13px
 * column, while urgent's filled badge is a full square. Sizing each one to its
 * own content made urgent rows in the issue list 3px wider than the rest, so
 * the identifier and status ring after it fell out of column. The box is fixed
 * here and both glyphs size themselves against it instead.
 */
const PRIORITY_GLYPH_BOX = "inline-flex size-4 shrink-0 items-center justify-center";

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
				{ class: "flex size-full items-center justify-center rounded-[3px] bg-[#f2994a]" },
				Span({ class: "text-[10px] font-bold leading-none text-black" }, "!"),
			);
		}

		const lit = PRIORITY_BARS[current];
		const heights = ["h-1.5", "h-2.5", "h-3.5"];
		return Div(
			{ class: "flex h-full items-end gap-[2px]" },
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
				class: cn(PRIORITY_GLYPH_BOX, className),
				title: PRIORITY_LABELS[priority],
			},
			render(priority),
		);
	}

	// A signal of a priority swaps the whole glyph, so the bars re-light in place.
	return Span(
		{ class: cn(PRIORITY_GLYPH_BOX, className) },
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

/** Stable per-user color, so the same person is the same color everywhere. */
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
	/** Set on bot members — see `type`/`harness` on `UserSummary`. */
	type?: UserType;
	harness?: HarnessKind | null;
}

export function UserAvatar(user: AvatarUser, className?: string) {
	// A bot wears its harness mark rather than initials. "CC" in a coloured
	// circle reads as a person; the Cursor or Claude mark is what actually tells
	// someone an agent wrote this.
	if (user.type === "agent") {
		return Span(
			{
				class: cn(
					"inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary",
					className,
				),
				title: user.name,
			},
			HarnessLogo(user.harness ?? "other", "size-3.5"),
		);
	}

	// The picture they chose, where there is one. `image` is already a URL the
	// browser can load — an app URL for one uploaded here, the provider's for one
	// that came with the account; see `userImageUrl`.
	if (user.image !== null && user.image !== undefined && user.image !== "") {
		return Span(
			{
				class: cn(
					"inline-flex size-5 shrink-0 overflow-hidden rounded-full select-none",
					className,
				),
				// Kept behind the picture, so a slow or failed load is still their
				// colour rather than a hole in the row.
				style: { backgroundColor: avatarColor(user.id) },
				title: user.name,
			},
			Img({ src: user.image, alt: "", class: "size-full object-cover" }),
		);
	}

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

/**
 * Marks a bot member wherever a name is shown.
 *
 * A person reading a comment should be able to tell at a glance that an agent
 * wrote it, without having to recognise the name.
 */
export function AgentBadge(className?: string) {
	return Span(
		{
			class: cn(
				"rounded bg-secondary px-1 py-px text-[9px] font-medium tracking-wide text-muted-foreground uppercase",
				className,
			),
		},
		"Agent",
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
