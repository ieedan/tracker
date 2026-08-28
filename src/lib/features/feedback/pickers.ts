// Feedback's inline editors: status, visibility and labels. Same shape as the
// issue pickers so a member switching between the two tabs never has to relearn
// the interaction.
import { Fragment, If, Span, derived, signal, type Readable } from "@implementjs/core";
import { Eye, EyeOff, Tag } from "@implementjs/lucide";
import { ResponsiveMenu, type MenuOption } from "@/lib/components/ui/responsive-menu";
import {
	FEEDBACK_STATUS_LABELS,
	FEEDBACK_TRIAGE_STATUSES,
	type FeedbackStatus,
	type FeedbackTriageStatus,
	type FeedbackVisibility,
} from "@/lib/domain/feedback";
import type { Label } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { FeedbackStatusIcon } from "./glyphs";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

/**
 * Status, which stops being a control the moment there is an issue.
 *
 * `follows` carries that issue's identifier when there is one. A converted
 * piece of feedback shows its status the same way it always did and simply
 * cannot be clicked, because there is nothing here to decide any more — the
 * value is the issue's, derived on the server (ENG-77). Leaving the menu up and
 * having the endpoint refuse the write would be offering a choice that is not
 * one; the same shape as `VisibilityPicker` with the board closed, for the same
 * reason.
 */
export function FeedbackStatusPicker(
	current: Readable<FeedbackStatus>,
	// Narrower than what it displays, and deliberately: the menu only ever
	// offers the four a person decides, so the endpoint's refusal of the rest
	// is something no call site can reach in the first place.
	onPick: (status: FeedbackTriageStatus) => void,
	options: {
		showLabel?: boolean;
		class?: string;
		follows?: Readable<string | null>;
	} = {},
) {
	const face = () =>
		Fragment(
			FeedbackStatusIcon(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((status) => FEEDBACK_STATUS_LABELS[status]),
					)
				: null,
		);

	const menu = ResponsiveMenu({
		heading: "Status",
		search: "Change status…",
		options: STATUS_OPTIONS,
		selected: derived([current], (status) => [status]),
		onSelect: (status) => onPick(status as FeedbackTriageStatus),
		trigger: { class: cn(triggerClass, options.class), title: "Status" },
		face,
	});

	if (options.follows === undefined) return menu;

	return If(options.follows.bind((identifier) => identifier === null))
		.Then(menu)
		.Else(
			Span(
				{
					class: cn(triggerClass, "cursor-default", options.class),
					title: options.follows.bind(
						(identifier) => `Follows ${identifier ?? "the issue"} — set the status there`,
					),
				},
				face(),
			),
		);
}

/**
 * Built once: the rows are constants and the icon factories are pure.
 *
 * Triage statuses only. The rest describe an issue's progress and are never
 * something a person picks here.
 */
const STATUS_OPTIONS: Readable<MenuOption[]> = signal(
	FEEDBACK_TRIAGE_STATUSES.map((status): MenuOption => ({
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
