// The four pickers that edit an issue in place — status, priority, assignee
// and labels. The list rows and the detail page share them, which is what keeps
// "click the status glyph and pick a new one" identical in both places.
//
// Each one is a `ResponsiveMenu`: a dropdown anchored to the pill on a pointer,
// and a drawer from the bottom edge on a phone (ENG-67). The rows are the same
// list either way — see responsive-menu.ts.
import {
	Dynamic,
	ForEach,
	Fragment,
	If,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ChevronDownIcon, Tag, Users } from "@implementjs/lucide";
import { ResponsiveMenu, type MenuOption } from "@/lib/components/ui/responsive-menu";
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
import type { Label, Member, Team, TeamRef, UserSummary, Workspace } from "@/lib/domain/schemas";
import { WorkspaceAvatar } from "@/lib/components/workspace-avatar";
import { TeamIcon } from "@/lib/features/teams/team-icon";
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

/** One value, as the menu wants it: a list of the ids currently ticked. */
function only(value: Readable<string>): Readable<string[]> {
	return derived([value], (picked) => [picked]);
}

/**
 * The two property lists that are the same on every issue. Built once, at the
 * module level: the rows are constants and the icon factories are pure, so
 * there is nothing per-picker about them.
 */
const STATUS_OPTIONS: Readable<MenuOption[]> = signal(
	ISSUE_STATUSES.map((status): MenuOption => ({
		value: status,
		label: STATUS_LABELS[status],
		icon: () => StatusIcon(status),
	})),
);

const PRIORITY_OPTIONS: Readable<MenuOption[]> = signal(
	ISSUE_PRIORITIES.map((priority): MenuOption => ({
		value: priority,
		label: PRIORITY_LABELS[priority],
		icon: () => PriorityIcon(priority),
	})),
);

/** The label swatch, which is the same dot on a row as it is on a chip. */
function LabelDot(color: string, size = "size-2.5") {
	return Span({
		class: cn(size, "shrink-0 rounded-full"),
		style: { backgroundColor: color },
	});
}

export function StatusPicker(
	current: Readable<IssueStatus>,
	onPick: (status: IssueStatus) => void,
	options: PickerOptions = {},
) {
	return ResponsiveMenu({
		heading: "Status",
		search: "Change status…",
		open: options.open,
		options: STATUS_OPTIONS,
		selected: only(current),
		onSelect: (status) => onPick(status as IssueStatus),
		trigger: { class: cn(triggerClass, options.class), title: "Status (S)" },
		face: () =>
			Fragment(
				StatusIcon(current),
				options.showLabel === true
					? Span(
							{},
							current.bind((status) => STATUS_LABELS[status]),
						)
					: null,
			),
	});
}

export function PriorityPicker(
	current: Readable<IssuePriority>,
	onPick: (priority: IssuePriority) => void,
	options: PickerOptions = {},
) {
	return ResponsiveMenu({
		heading: "Priority",
		search: "Set priority…",
		open: options.open,
		options: PRIORITY_OPTIONS,
		selected: only(current),
		onSelect: (priority) => onPick(priority as IssuePriority),
		trigger: { class: cn(triggerClass, options.class), title: "Priority (P)" },
		face: () =>
			Fragment(
				PriorityIcon(current),
				options.showLabel === true
					? Span(
							{},
							current.bind((priority) => PRIORITY_LABELS[priority]),
						)
					: null,
			),
	});
}

export function AssigneePicker(
	current: Readable<UserSummary | null>,
	members: Readable<Member[]>,
	onPick: (userId: string | null) => void,
	options: PickerOptions = {},
) {
	return ResponsiveMenu({
		heading: "Assign to",
		search: "Assign to…",
		open: options.open,
		options: derived([members], (list) => [
			{ value: UNASSIGNED, label: "Unassigned", icon: () => UnassignedAvatar() },
			...list.map((member): MenuOption => ({
				value: member.user.id,
				label: member.user.name,
				// The avatar falls back to initials, which would otherwise be part
				// of what the filter matches on.
				search: member.user.name,
				icon: () => UserAvatar(member.user),
			})),
		]),
		selected: derived([current], (user) => [user?.id ?? UNASSIGNED]),
		onSelect: (id) => onPick(id === UNASSIGNED ? null : id),
		trigger: { class: cn(triggerClass, options.class), title: "Assignee (A)" },
		face: () =>
			Fragment(
				AssigneeAvatar(current, CHIP_GLYPH.avatar),
				options.showLabel === true
					? Span(
							{},
							current.bind((user) => user?.name ?? "Unassigned"),
						)
					: null,
			),
	});
}

export function LabelPicker(
	selected: Readable<Label[]>,
	available: Readable<Label[]>,
	onToggle: (labelId: string) => void,
	options: { class?: string; open?: Signal<boolean> } = {},
) {
	return ResponsiveMenu({
		heading: "Labels",
		search: "Add label…",
		multiple: true,
		open: options.open,
		options: derived([available], (labels) =>
			labels.map((label): MenuOption => ({
				value: label.id,
				label: label.name,
				icon: () => LabelDot(label.color),
			})),
		),
		selected: derived([selected], (labels) => labels.map((label) => label.id)),
		onSelect: onToggle,
		trigger: { class: cn(triggerClass, options.class), title: "Labels (L)" },
		face: () => LabelTrigger(selected),
	});
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

/**
 * The team's tile, or the generic people glyph while no team is chosen — the
 * tile is a real node, so it is rebuilt rather than bound to.
 */
function TeamFace(current: Readable<TeamRef | null>, className?: string) {
	return Dynamic([current], (team) =>
		team === null ? Users({ class: cn("size-3.5", className) }) : TeamIcon(team, className),
	);
}

/** Which team owns the issue — and therefore what its identifier reads. */
export function TeamPicker(
	current: Readable<TeamRef | null>,
	teams: Readable<Team[]>,
	onPick: (key: string) => void,
	options: PickerOptions & { crumb?: boolean } = {},
) {
	const face = () =>
		options.crumb === true
			? Fragment(
					TeamFace(current, "size-4"),
					Span(
						{ class: "font-mono leading-none" },
						current.bind((team) => team?.key ?? "Team"),
					),
				)
			: Fragment(
					TeamFace(current, "size-4"),
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

	const triggerClassName =
		options.crumb === true
			? "h-auto min-h-0 gap-1.5 px-1 py-0 text-[13px] leading-none font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
			: options.select === true
				? "h-9 w-full justify-start px-3 text-[13px] font-normal"
				: triggerClass;

	return ResponsiveMenu({
		heading: "Team",
		search: "Change team…",
		open: options.open,
		options: derived([teams], (list) =>
			list.map((team): MenuOption => ({
				value: team.key,
				label: team.name,
				// The tile falls back to the team's initial, which would otherwise
				// be part of what the filter matches on; the key is worth keeping
				// searchable, so it joins the name rather than replacing it.
				search: `${team.name} ${team.key}`,
				hint: team.key,
				icon: () => TeamIcon(team, "size-4"),
			})),
		),
		selected: derived([current], (team) => (team === null ? [] : [team.key])),
		onSelect: onPick,
		trigger: {
			variant: options.crumb !== true && options.select === true ? "outline" : "ghost",
			class: cn(triggerClassName, options.class),
			title: "Team",
		},
		face,
	});
}

/**
 * Which workspace the issue lands in — the crumb ahead of the team in the
 * composer (ENG-58). With only one workspace there is nothing to pick, so the
 * crumb is static text rather than a dropdown that opens onto a single row.
 */
export function WorkspacePicker(
	current: Readable<Workspace | null>,
	workspaces: Readable<Workspace[]>,
	onPick: (slug: string) => void,
	options: { class?: string } = {},
) {
	// Fresh nodes per call — the crumb face is rendered in both branches.
	const face = () =>
		Fragment(
			Dynamic([current], (workspace) =>
				WorkspaceAvatar(workspace ?? undefined, "size-4 rounded-[4px] text-[8px]"),
			),
			Span(
				{ class: "max-w-36 truncate leading-none" },
				current.bind((workspace) => workspace?.name ?? "Workspace"),
			),
		);

	return If(
		workspaces.bind((list) => list.length > 1),
		ResponsiveMenu({
			heading: "Workspace",
			search: "File in workspace…",
			options: derived([workspaces], (list) =>
				list.map((workspace): MenuOption => ({
					value: workspace.slug,
					label: workspace.name,
					// The avatar falls back to an initial, which would otherwise be
					// part of what the filter matches on.
					search: workspace.name,
					icon: () => WorkspaceAvatar(workspace, "size-4 rounded-[4px] text-[8px]"),
				})),
			),
			selected: derived([current], (workspace) => (workspace === null ? [] : [workspace.slug])),
			onSelect: onPick,
			trigger: {
				class: cn(
					"h-auto min-h-0 gap-1.5 px-1 py-0 text-[13px] leading-none font-medium text-muted-foreground hover:bg-transparent hover:text-foreground",
					options.class,
				),
				title: "Workspace",
			},
			face,
		}),
	).Else(
		Span(
			{
				class: cn(
					"flex items-center gap-1.5 px-1 text-[13px] leading-none font-medium text-muted-foreground",
					options.class,
				),
			},
			face(),
		),
	);
}

/**
 * The small team tag shown on a workspace-wide issue row — the tile beside the
 * key, so a row is scannable by color before you read the letters.
 */
export function TeamBadge(team: Readable<TeamRef>) {
	return Span(
		{
			class:
				"inline-flex shrink-0 items-center gap-1 rounded border border-border py-px pr-1 pl-0.5 font-mono text-[10px] text-muted-foreground",
			title: team.bind((value) => value.name),
		},
		Dynamic([team], (value) => TeamIcon(value, "size-3")),
		team.bind("key"),
	);
}
