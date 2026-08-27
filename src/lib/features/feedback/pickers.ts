// Feedback's inline editors: status, visibility and labels. Same shape as the
// issue pickers so a member switching between the two tabs never has to relearn
// the interaction.
import { Fragment, If, Span, derived, signal, type Readable } from "@implementjs/core";
import { Eye, EyeOff, Tag } from "@implementjs/lucide";
import { ResponsiveMenu, type MenuOption } from "@/lib/components/ui/responsive-menu";
import {
	FEEDBACK_STATUSES,
	FEEDBACK_STATUS_LABELS,
	type FeedbackStatus,
	type FeedbackVisibility,
} from "@/lib/domain/feedback";
import type { Label } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { FeedbackStatusIcon } from "./glyphs";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

export function FeedbackStatusPicker(
	current: Readable<FeedbackStatus>,
	onPick: (status: FeedbackStatus) => void,
	options: { showLabel?: boolean; class?: string } = {},
) {
	return ResponsiveMenu({
		heading: "Status",
		search: "Change status…",
		options: STATUS_OPTIONS,
		selected: derived([current], (status) => [status]),
		onSelect: (status) => onPick(status as FeedbackStatus),
		trigger: { class: cn(triggerClass, options.class), title: "Status" },
		face: () =>
			Fragment(
				FeedbackStatusIcon(current),
				options.showLabel === true
					? Span(
							{},
							current.bind((status) => FEEDBACK_STATUS_LABELS[status]),
						)
					: null,
			),
	});
}

/** Built once: the rows are constants and the icon factories are pure. */
const STATUS_OPTIONS: Readable<MenuOption[]> = signal(
	FEEDBACK_STATUSES.map((status): MenuOption => ({
		value: status,
		label: FEEDBACK_STATUS_LABELS[status],
		icon: () => FeedbackStatusIcon(status),
	})),
);

const VISIBILITY_OPTIONS: Readable<MenuOption[]> = signal([
	{ value: "private", label: "Private", icon: () => EyeOff({ class: "size-3.5" }) },
	{ value: "public", label: "On the public board", icon: () => Eye({ class: "size-3.5" }) },
]);

/**
 * Public or private.
 *
 * With the board closed there is nothing to choose between, so this renders as
 * a static, disabled control saying why rather than a menu whose only option is
 * refused by the server.
 *
 * implement:bug:#5: `DropdownMenuTrigger` types `disabled` as
 * `Signal<boolean> | boolean`, so a `derived`/`Readable<boolean>` — the only
 * thing you have when the answer comes from loaded data — will not typecheck.
 * Splitting the control sidesteps it and reads better here anyway.
 */
export function VisibilityPicker(
	current: Readable<FeedbackVisibility>,
	boardOpen: Readable<boolean>,
	onPick: (visibility: FeedbackVisibility) => void,
	options: { class?: string } = {},
) {
	return If(boardOpen)
		.Then(
			ResponsiveMenu({
				heading: "Visibility",
				options: VISIBILITY_OPTIONS,
				selected: derived([current], (visibility) => [visibility]),
				onSelect: (visibility) => onPick(visibility as FeedbackVisibility),
				trigger: { class: cn(triggerClass, options.class), title: "Visibility" },
				face: () =>
					Fragment(
						VisibilityIcon(current),
						Span(
							{},
							current.bind((next) => (next === "public" ? "Public" : "Private")),
						),
					),
			}),
		)
		.Else(
			Span(
				{
					class: cn(triggerClass, "cursor-not-allowed opacity-60", options.class),
					title: "Turn on the public board in Settings first",
				},
				EyeOff({ class: "size-3.5" }),
				"Private",
			),
		);
}

export function VisibilityIcon(current: Readable<FeedbackVisibility>, className?: string) {
	return If(current.bind((value) => value === "public"))
		.Then(Eye({ class: cn("size-3.5", className) }))
		.Else(EyeOff({ class: cn("size-3.5", className) }));
}

export function FeedbackLabelPicker(
	selected: Readable<Label[]>,
	available: Readable<Label[]>,
	onToggle: (labelId: string) => void,
	options: { class?: string } = {},
) {
	return ResponsiveMenu({
		heading: "Labels",
		search: "Add label…",
		multiple: true,
		options: derived([available], (labels) =>
			labels.map((label): MenuOption => ({
				value: label.id,
				label: label.name,
				icon: () =>
					Span({
						class: "size-2.5 shrink-0 rounded-full",
						style: { backgroundColor: label.color },
					}),
			})),
		),
		selected: derived([selected], (labels) => labels.map((label) => label.id)),
		onSelect: onToggle,
		trigger: { class: cn(triggerClass, options.class), title: "Labels" },
		face: () =>
			Fragment(
				Tag({ class: "size-3.5" }),
				Span(
					{},
					selected.bind((labels) =>
						labels.length === 0 ? "Label" : `${labels.length} label${labels.length > 1 ? "s" : ""}`,
					),
				),
			),
	});
}
