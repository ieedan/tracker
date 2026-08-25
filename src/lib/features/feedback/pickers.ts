// Feedback's inline editors: status, visibility and labels. Same shape as the
// issue pickers so a member switching between the two tabs never has to relearn
// the interaction.
import { ForEach, If, Span, type Child, type Readable } from "@implementjs/core";
import { Check, Eye, EyeOff, Tag } from "@implementjs/lucide";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
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
	return DropdownMenu(
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
			DropdownMenuGroup(
				DropdownMenuGroupHeading("Status"),
				...FEEDBACK_STATUSES.map((status) =>
					DropdownMenuItem(
						{ onSelect: () => onPick(status) },
						FeedbackStatusIcon(status),
						Span({ class: "flex-1" }, FEEDBACK_STATUS_LABELS[status]),
						Tick(current.bind((value) => value === status)),
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
	return If(boardOpen)
		.Then(
			DropdownMenu(
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
						current.bind((value) => (value === "public" ? "Public" : "Private")),
					),
				),
				DropdownMenuContent(
					{ class: "w-56", align: "start" },
					DropdownMenuGroup(
						DropdownMenuGroupHeading("Visibility"),
						DropdownMenuItem(
							{ onSelect: () => onPick("private") },
							EyeOff({ class: "size-3.5" }),
							Span({ class: "flex-1" }, "Private"),
							Tick(current.bind((value) => value === "private")),
						),
						DropdownMenuItem(
							{ onSelect: () => onPick("public") },
							Eye({ class: "size-3.5" }),
							Span({ class: "flex-1" }, "On the public board"),
							Tick(current.bind((value) => value === "public")),
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
	return DropdownMenu(
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
			DropdownMenuGroup(
				DropdownMenuGroupHeading("Labels"),
				ForEach(
					available,
					(label) => label.id,
					(label) =>
						DropdownMenuItem(
							{ closeOnSelect: false, onSelect: () => onToggle(label.get().id) },
							Span({
								class: "size-2.5 shrink-0 rounded-full",
								style: { backgroundColor: label.get().color },
							}),
							Span({ class: "flex-1 truncate" }, label.bind("name")),
							Tick(selected.bind((labels) => labels.some((entry) => entry.id === label.get().id))),
						),
				),
			),
		),
	);
}

function Tick(shown: Readable<boolean>): Child {
	return If(shown, Check({ class: "size-3.5 shrink-0 text-primary" }));
}
