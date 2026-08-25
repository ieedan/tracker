// Feedback's inline editors: status, visibility and labels. Same shape as the
// issue pickers so a member switching between the two tabs never has to relearn
// the interaction.
import { ForEach, If, ImplementEffect, Span, signal, type Readable } from "@implementjs/core";
import { Eye, EyeOff, Tag } from "@implementjs/lucide";
import {
	DropdownMenu,
	DropdownMenuCheckboxGroup,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { MenuCheckbox, applyIdDiff } from "@/lib/components/ui/menu-checkbox";
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
	const value = signal<string | null>(current.get());

	return DropdownMenu(
		ImplementEffect([current], (status) => value.set(status)),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, options.class), title: "Status" },
			FeedbackStatusIcon(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((status) => FEEDBACK_STATUS_LABELS[status]),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-48", align: "start" },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (status) => {
						if (typeof status === "string") onPick(status as FeedbackStatus);
					},
				},
				DropdownMenuGroupHeading("Status"),
				...FEEDBACK_STATUSES.map((status) =>
					DropdownMenuRadioItem(
						{ value: status },
						FeedbackStatusIcon(status),
						Span({ class: "flex-1" }, FEEDBACK_STATUS_LABELS[status]),
					),
				),
			),
		),
	);
}

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
	const value = signal<string | null>(current.get());

	return If(boardOpen)
		.Then(
			DropdownMenu(
				ImplementEffect([current], (visibility) => value.set(visibility)),
				DropdownMenuTrigger(
					{
						variant: "ghost",
						size: "sm",
						class: cn(triggerClass, options.class),
						title: "Visibility",
					},
					VisibilityIcon(current),
					Span(
						{},
						current.bind((next) => (next === "public" ? "Public" : "Private")),
					),
				),
				DropdownMenuContent(
					{ class: "w-56", align: "start" },
					DropdownMenuRadioGroup(
						{
							value,
							onValueChange: (visibility) => {
								if (typeof visibility === "string") {
									onPick(visibility as FeedbackVisibility);
								}
							},
						},
						DropdownMenuGroupHeading("Visibility"),
						DropdownMenuRadioItem(
							{ value: "private" },
							EyeOff({ class: "size-3.5" }),
							Span({ class: "flex-1" }, "Private"),
						),
						DropdownMenuRadioItem(
							{ value: "public" },
							Eye({ class: "size-3.5" }),
							Span({ class: "flex-1" }, "On the public board"),
						),
					),
				),
			),
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
	const selectedIds = signal(selected.get().map((label) => label.id));

	return DropdownMenu(
		ImplementEffect([selected], (labels) => selectedIds.set(labels.map((label) => label.id))),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, options.class), title: "Labels" },
			Tag({ class: "size-3.5" }),
			Span(
				{},
				selected.bind((labels) =>
					labels.length === 0 ? "Label" : `${labels.length} label${labels.length > 1 ? "s" : ""}`,
				),
			),
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start" },
			DropdownMenuCheckboxGroup(
				{
					value: selectedIds,
					onValueChange: (ids) => {
						applyIdDiff(
							selected.get().map((label) => label.id),
							ids,
							onToggle,
						);
					},
				},
				DropdownMenuGroupHeading("Labels"),
				ForEach(
					available,
					(label) => label.id,
					(label) =>
						DropdownMenuCheckboxItem(
							{
								value: label.get().id,
								indicator: MenuCheckbox(selectedIds, label.get().id),
							},
							Span({
								class: "size-2.5 shrink-0 rounded-full",
								style: { backgroundColor: label.get().color },
							}),
							Span({ class: "flex-1 truncate" }, label.bind("name")),
						),
				),
			),
		),
	);
}
