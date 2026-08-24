// The four dropdowns that edit an issue in place — status, priority, assignee
// and labels. The list rows and the detail page share them, which is what keeps
// "click the status glyph and pick a new one" identical in both places.
import { Div, ForEach, If, Span, type Child, type Readable } from "@implementjs/core";
import { Check, Tag } from "@implementjs/lucide";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { PriorityIcon, StatusIcon, UnassignedAvatar, UserAvatar } from "@/lib/components/glyphs";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_LABELS,
	STATUS_LABELS,
	type IssuePriority,
	type IssueStatus,
} from "@/lib/domain/issues";
import type { Label, Member, UserSummary } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

export function StatusPicker(
	current: Readable<IssueStatus>,
	onPick: (status: IssueStatus) => void,
	options: { showLabel?: boolean; class?: string } = {},
) {
	return DropdownMenu(
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, options.class), title: "Status" },
			StatusIcon(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((status) => STATUS_LABELS[status]),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-48", align: "start" },
			DropdownMenuGroup(
				DropdownMenuGroupHeading("Status"),
				...ISSUE_STATUSES.map((status) =>
					DropdownMenuItem(
						{ onSelect: () => onPick(status) },
						StatusIcon(status),
						Span({ class: "flex-1" }, STATUS_LABELS[status]),
						Tick(current.bind((value) => value === status)),
					),
				),
			),
		),
	);
}

export function PriorityPicker(
	current: Readable<IssuePriority>,
	onPick: (priority: IssuePriority) => void,
	options: { showLabel?: boolean; class?: string } = {},
) {
	return DropdownMenu(
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, options.class), title: "Priority" },
			PriorityIcon(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((priority) => PRIORITY_LABELS[priority]),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-48", align: "start" },
			DropdownMenuGroup(
				DropdownMenuGroupHeading("Priority"),
				...ISSUE_PRIORITIES.map((priority) =>
					DropdownMenuItem(
						{ onSelect: () => onPick(priority) },
						PriorityIcon(priority),
						Span({ class: "flex-1" }, PRIORITY_LABELS[priority]),
						Tick(current.bind((value) => value === priority)),
					),
				),
			),
		),
	);
}

export function AssigneePicker(
	current: Readable<UserSummary | null>,
	members: Readable<Member[]>,
	onPick: (userId: string | null) => void,
	options: { showLabel?: boolean; class?: string } = {},
) {
	return DropdownMenu(
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, options.class), title: "Assignee" },
			AssigneeAvatar(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((user) => user?.name ?? "Unassigned"),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start" },
			DropdownMenuGroup(
				DropdownMenuGroupHeading("Assign to"),
				DropdownMenuItem(
					{ onSelect: () => onPick(null) },
					UnassignedAvatar(),
					Span({ class: "flex-1" }, "Unassigned"),
					Tick(current.bind((user) => user === null)),
				),
				ForEach(
					members,
					(member) => member.id,
					(member) =>
						DropdownMenuItem(
							{ onSelect: () => onPick(member.get().user.id) },
							UserAvatar(member.get().user),
							Span(
								{ class: "flex-1 truncate" },
								member.bind((value) => value.user.name),
							),
							Tick(current.bind((user) => user?.id === member.get().user.id)),
						),
				),
			),
		),
	);
}

export function LabelPicker(
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
							// Labels are multi-select, so the menu stays open between picks.
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

/** The assignee's avatar, or the dashed placeholder when there is none. */
export function AssigneeAvatar(current: Readable<UserSummary | null>) {
	return Div(
		{ class: "flex items-center" },
		If(current.bind((user) => user !== null))
			.Then(
				Div(
					{ class: "contents" },
					// `current` is non-null inside this branch; bind reads it safely.
					UserAvatarOf(current),
				),
			)
			.Else(UnassignedAvatar()),
	);
}

function UserAvatarOf(current: Readable<UserSummary | null>) {
	const user = current.get();
	if (user === null) return UnassignedAvatar();
	return UserAvatar(user);
}

/** The coloured pills shown on a row and on the detail page. */
export function LabelChips(labels: Readable<Label[]>) {
	return ForEach(
		labels,
		(label) => label.id,
		(label) =>
			Span(
				{
					class:
						"inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-muted-foreground",
				},
				Span({
					class: "size-2 rounded-full",
					style: { backgroundColor: label.get().color },
				}),
				label.bind("name"),
			),
	);
}
