// The four dropdowns that edit an issue in place — status, priority, assignee
// and labels. The list rows and the detail page share them, which is what keeps
// "click the status glyph and pick a new one" identical in both places.
import {
	Dynamic,
	ForEach,
	Fragment,
	ImplementEffect,
	Span,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ChevronDownIcon, Tag, Users } from "@implementjs/lucide";
import { MenuCheckbox, applyIdDiff } from "@/lib/components/ui/menu-checkbox";
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
import {
	CHIP_GLYPH,
	PriorityIcon,
	StatusIcon,
	UnassignedAvatar,
	UserAvatar,
} from "@/lib/components/glyphs";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_LABELS,
	STATUS_LABELS,
	type IssuePriority,
	type IssueStatus,
} from "@/lib/domain/issues";
import type { Label, Member, Team, TeamRef, UserSummary } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

/** Radio items need a string value; no real user id is the empty string. */
const UNASSIGNED = "";

type PickerOptions = {
	showLabel?: boolean;
	class?: string;
	open?: Signal<boolean>;
	/** Full-width select trigger: left-aligned value, trailing chevron. */
	select?: boolean;
};

/**
 * Radio/checkbox groups want a writable Signal. Callers often only have a
 * Readable of the issue, so this is a live view that follows it — the same
 * shape Settings uses to keep a local list in sync with loaded data.
 */
function followRadio<T>(
	source: Readable<T>,
	pick: (value: T) => string | null,
): Signal<string | null> {
	return signal<string | null>(pick(source.get()));
}

function syncRadio<T>(
	source: Readable<T>,
	value: Signal<string | null>,
	pick: (value: T) => string | null,
) {
	return ImplementEffect([source], (next) => value.set(pick(next)));
}

export function StatusPicker(
	current: Readable<IssueStatus>,
	onPick: (status: IssueStatus) => void,
	options: PickerOptions = {},
) {
	const value = followRadio(current, (status) => status);

	return DropdownMenu(
		{ open: options.open },
		syncRadio(current, value, (status) => status),
		DropdownMenuTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(triggerClass, options.class),
				title: "Status (S)",
			},
			StatusIcon(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((status) => STATUS_LABELS[status]),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: "Change status…", hotkeys: true },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (status) => {
						if (typeof status === "string") onPick(status as IssueStatus);
					},
				},
				DropdownMenuGroupHeading("Status"),
				...ISSUE_STATUSES.map((status) =>
					DropdownMenuRadioItem(
						{ value: status },
						StatusIcon(status),
						Span({ class: "flex-1" }, STATUS_LABELS[status]),
					),
				),
			),
		),
	);
}

export function PriorityPicker(
	current: Readable<IssuePriority>,
	onPick: (priority: IssuePriority) => void,
	options: PickerOptions = {},
) {
	const value = followRadio(current, (priority) => priority);

	return DropdownMenu(
		{ open: options.open },
		syncRadio(current, value, (priority) => priority),
		DropdownMenuTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(triggerClass, options.class),
				title: "Priority (P)",
			},
			PriorityIcon(current),
			options.showLabel === true
				? Span(
						{},
						current.bind((priority) => PRIORITY_LABELS[priority]),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: "Set priority…", hotkeys: true },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (priority) => {
						if (typeof priority === "string") onPick(priority as IssuePriority);
					},
				},
				DropdownMenuGroupHeading("Priority"),
				...ISSUE_PRIORITIES.map((priority) =>
					DropdownMenuRadioItem(
						{ value: priority },
						PriorityIcon(priority),
						Span({ class: "flex-1" }, PRIORITY_LABELS[priority]),
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
	options: PickerOptions = {},
) {
	const value = followRadio(current, (user) => user?.id ?? UNASSIGNED);

	return DropdownMenu(
		{ open: options.open },
		syncRadio(current, value, (user) => user?.id ?? UNASSIGNED),
		DropdownMenuTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(triggerClass, options.class),
				title: "Assignee (A)",
			},
			AssigneeAvatar(current, CHIP_GLYPH.avatar),
			options.showLabel === true
				? Span(
						{},
						current.bind((user) => user?.name ?? "Unassigned"),
					)
				: null,
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: "Assign to…", hotkeys: true },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (id) => {
						if (id === null || id === UNASSIGNED) onPick(null);
						else if (typeof id === "string") onPick(id);
					},
				},
				DropdownMenuGroupHeading("Assign to"),
				DropdownMenuRadioItem(
					{ value: UNASSIGNED },
					UnassignedAvatar(),
					Span({ class: "flex-1" }, "Unassigned"),
				),
				ForEach(
					members,
					(member) => member.id,
					(member) =>
						DropdownMenuRadioItem(
							// The avatar falls back to initials, which would otherwise be
							// part of what the filter matches on.
							{ value: member.get().user.id, label: member.get().user.name },
							UserAvatar(member.get().user),
							Span(
								{ class: "flex-1 truncate" },
								member.bind((value) => value.user.name),
							),
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
	options: { class?: string; open?: Signal<boolean> } = {},
) {
	const selectedIds = signal(selected.get().map((label) => label.id));

	return DropdownMenu(
		{ open: options.open },
		ImplementEffect([selected], (labels) => selectedIds.set(labels.map((label) => label.id))),
		DropdownMenuTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(triggerClass, options.class),
				title: "Labels (L)",
			},
			LabelTrigger(selected),
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: "Add label…", hotkeys: true },
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

/** The assignee's avatar, or the dashed placeholder when there is none. */
export function AssigneeAvatar(current: Readable<UserSummary | null>, className?: string) {
	return Dynamic([current], (user) =>
		user === null ? UnassignedAvatar(className) : UserAvatar(user, className),
	);
}

/**
 * Linear's label chip: empty is a tag, one label is color + name, several
 * are overlapping dots followed by a count ("3 labels").
 */
function LabelTrigger(selected: Readable<Label[]>) {
	return Dynamic([selected], (labels) => {
		if (labels.length === 0) {
			return Fragment(Tag({ class: "size-3.5" }), Span({}, "Label"));
		}
		if (labels.length === 1) {
			const label = labels[0]!;
			return Fragment(
				Span({
					class: "size-2.5 shrink-0 rounded-full",
					style: { backgroundColor: label.color },
				}),
				Span({ class: "max-w-28 truncate" }, label.name),
			);
		}
		return Fragment(
			Span(
				{ class: "flex items-center" },
				...labels.slice(0, 4).map((label, index) =>
					Span({
						class: cn(
							"inline-block size-2.5 shrink-0 rounded-full border-2 border-background",
							index > 0 && "-ml-1.5",
						),
						style: { backgroundColor: label.color },
						title: label.name,
					}),
				),
			),
			Span(
				{ class: "whitespace-nowrap" },
				`${labels.length} label${labels.length === 1 ? "" : "s"}`,
			),
		);
	});
}

/** The colored pills shown on a row and on the detail page. */
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

/** Which team owns the issue — and therefore what its identifier reads. */
export function TeamPicker(
	current: Readable<TeamRef | null>,
	teams: Readable<Team[]>,
	onPick: (key: string) => void,
	options: PickerOptions & { crumb?: boolean } = {},
) {
	const value = followRadio(current, (team) => team?.key ?? null);

	const trigger =
		options.crumb === true
			? DropdownMenuTrigger(
					{
						variant: "ghost",
						size: "sm",
						class: cn(
							"h-auto min-h-0 px-1 py-0 text-[13px] leading-none font-medium text-muted-foreground hover:bg-transparent hover:text-foreground",
							options.class,
						),
						title: "Team",
					},
					Span(
						{ class: "font-mono leading-none" },
						current.bind((team) => team?.key ?? "Team"),
					),
				)
			: DropdownMenuTrigger(
					{
						variant: options.select === true ? "outline" : "ghost",
						size: "sm",
						class: cn(
							options.select === true
								? "h-9 w-full justify-start px-3 text-[13px] font-normal"
								: triggerClass,
							options.class,
						),
						title: "Team",
					},
					Users({ class: "size-3.5" }),
					Span(
						{ class: options.showLabel === true ? "" : "font-mono" },
						current.bind((team) => team?.key ?? "Team"),
					),
					options.showLabel === true
						? Span(
								{ class: "min-w-0 truncate text-muted-foreground" },
								current.bind((team) => team?.name ?? ""),
							)
						: null,
					options.select === true
						? ChevronDownIcon({
								"aria-hidden": true,
								class: "ml-auto size-4 shrink-0 opacity-50",
							})
						: null,
				);

	return DropdownMenu(
		{ open: options.open },
		syncRadio(current, value, (team) => team?.key ?? null),
		trigger,
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: "Change team…", hotkeys: true },
			DropdownMenuRadioGroup(
				{
					value,
					onValueChange: (key) => {
						if (typeof key === "string") onPick(key);
					},
				},
				DropdownMenuGroupHeading("Team"),
				ForEach(
					teams,
					(team) => team.id,
					(team) =>
						DropdownMenuRadioItem(
							{ value: team.get().key },
							Span(
								{ class: "w-10 shrink-0 font-mono text-[11px] text-muted-foreground" },
								team.bind("key"),
							),
							Span({ class: "flex-1 truncate" }, team.bind("name")),
						),
				),
			),
		),
	);
}

/** The small monospace team tag shown on a workspace-wide issue row. */
export function TeamBadge(team: Readable<TeamRef>) {
	return Span(
		{
			class:
				"shrink-0 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground",
			title: team.get().name,
		},
		team.bind("key"),
	);
}
