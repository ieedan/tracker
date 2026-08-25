/**
 * The filter bar, in Linear's shape.
 *
 * Two moving parts:
 *
 *   - **Add menu** — a dropdown of dimensions. Hovering a field (or ArrowRight /
 *     Enter / Space) opens its values in a submenu. Values use the same
 *     checkbox-or-row pattern as the issue label picker: the box keeps the
 *     menu open so several can be ticked, the rest of the row toggles and closes.
 *   - **Chips** — one per active filter, reading `Status is Todo, In Progress`.
 *     The operator opens a small menu of `is` / `is not`, the values reopen the
 *     searchable picker with that same checkbox split, and the × removes the
 *     filter.
 *
 * Filters themselves live in the URL — see `filters.ts`. Checkbox groups
 * mirror a field's values so they can stay writable; every interaction still
 * hands a new list up to `onChange`.
 */
import {
	Div,
	Dynamic,
	ForEach,
	If,
	ImplementEffect,
	Span,
	derived,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Check, ListFilter, X } from "@implementjs/lucide";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandGroupItems,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/ui/command";
import {
	DropdownMenu,
	DropdownMenuCheckboxGroup,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/components/ui/popover";
import { Button } from "@/lib/components/ui/button";
import { MenuCheckbox } from "@/lib/components/ui/menu-checkbox";
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
} from "@/lib/domain/issues";
import type { Label, Member, Team } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import {
	FILTER_FIELD_LABELS,
	FILTER_FIELDS,
	NO_ASSIGNEE,
	operatorLabel,
	removeField,
	setFieldValues,
	withFilter,
	type Filter,
	type FilterField,
} from "./filters";

/** Everything the value lists are built from. */
export interface FilterContext {
	teams: Team[];
	members: Member[];
	labels: Label[];
	/** Hidden on a team route, where every issue is that team already. */
	hideTeam: boolean;
}

interface FilterOption {
	value: string;
	label: string;
	icon?: Child;
}

function optionsFor(field: FilterField, context: FilterContext, compact = false): FilterOption[] {
	const avatar = compact ? CHIP_GLYPH.avatar : undefined;

	switch (field) {
		case "status":
			return ISSUE_STATUSES.map((status) => ({
				value: status,
				label: STATUS_LABELS[status],
				icon: StatusIcon(status, compact ? CHIP_GLYPH.status : undefined),
			}));
		case "priority":
			return ISSUE_PRIORITIES.map((priority) => ({
				value: priority,
				label: PRIORITY_LABELS[priority],
				// The priority bars are fixed heights rather than one box, so they
				// shrink by scaling instead of by a size class.
				icon: PriorityIcon(priority, compact ? CHIP_GLYPH.priority : undefined),
			}));
		case "assignee":
			return [
				{ value: NO_ASSIGNEE, label: "No assignee", icon: UnassignedAvatar(avatar) },
				...context.members.map((member) => ({
					value: member.user.id,
					label: member.user.name,
					icon: UserAvatar(member.user, avatar),
				})),
			];
		case "creator":
			return context.members.map((member) => ({
				value: member.user.id,
				label: member.user.name,
				icon: UserAvatar(member.user, avatar),
			}));
		case "label":
			return context.labels.map((label) => ({
				value: label.id,
				label: label.name,
				icon: Span({
					class: cn("shrink-0 rounded-full", compact ? CHIP_GLYPH.dot : "size-2.5"),
					style: { backgroundColor: label.color },
				}),
			}));
		case "team":
			return context.teams.map((team) => ({
				value: team.key,
				label: team.name,
				icon: Span(
					{
						class: cn("shrink-0 font-mono text-[10px] text-muted-foreground", compact ? "" : "w-8"),
					},
					team.key,
				),
			}));
	}
}

/** The human name of a value, for rendering chips. */
function labelOf(field: FilterField, value: string, context: FilterContext): string {
	const found = optionsFor(field, context).find((option) => option.value === value);
	return found?.label ?? value;
}

/**
 * The glyphs for a chip's values — status rings, avatars, label dots.
 *
 * Capped, because a chip is a chip: past a few the summary reads "4 statuses"
 * and a row of icons would just be noise.
 */
const MAX_CHIP_ICONS = 3;

function iconsFor(filter: Filter, context: FilterContext): Child[] {
	if (filter.values.length > MAX_CHIP_ICONS) return [];
	const options = optionsFor(filter.field, context, true);
	return filter.values
		.map((value) => options.find((option) => option.value === value)?.icon)
		.filter((icon): icon is Child => icon !== undefined && icon !== null);
}

const availableFields = (context: FilterContext): FilterField[] =>
	FILTER_FIELDS.filter((field) => !(field === "team" && context.hideTeam));

function valuesOf(list: Filter[], field: FilterField): string[] {
	return list.find((filter) => filter.field === field)?.values ?? [];
}

function sameIds(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	const set = new Set(left);
	return right.every((id) => set.has(id));
}

/**
 * A writable copy of one field's values, kept in lockstep with the URL.
 *
 * The checkbox group (and the command list) need a signal they can write;
 * filters themselves are derived from the query string. Equality guards stop
 * the two effects from echoing each other.
 */
function bindFilterValues(
	filters: Readable<Filter[]>,
	field: FilterField,
	onChange: (next: Filter[]) => void,
): { selected: Signal<string[]>; sync: Child[] } {
	const selected = signal(valuesOf(filters.get(), field));

	return {
		selected,
		sync: [
			ImplementEffect([filters], (list) => {
				const next = valuesOf(list, field);
				if (!sameIds(selected.get(), next)) selected.set(next);
			}),
			ImplementEffect(
				[selected],
				(ids) => {
					const current = valuesOf(filters.get(), field);
					if (sameIds(current, ids)) return;
					onChange(setFieldValues(filters.get(), field, ids));
				},
				{ immediate: false },
			),
		],
	};
}

// ---------------------------------------------------------------------------

export interface FilterBarProps {
	filters: Readable<Filter[]>;
	context: Readable<FilterContext>;
	onChange: (next: Filter[]) => void;
}

export function FilterBar({ filters, context, onChange }: FilterBarProps) {
	// Its own open state: the header's button and this one are two separate
	// menus, and sharing a signal opens both at once on top of each other.
	const inlineOpen = signal(false);

	return If(
		filters.bind((list) => list.length > 0),
		Div(
			{
				class: "flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2",
			},
			ForEach(
				filters,
				(filter) => filter.field,
				(filter) => FilterChip(filter, filters, context, onChange),
			),

			AddFilterButton(filters, context, onChange, inlineOpen, "subtle"),

			Div({ class: "flex-1" }),
			Button(
				{
					size: "sm",
					variant: "ghost",
					class: "h-6 px-2 text-[11px] text-muted-foreground",
					onClick: () => onChange([]),
				},
				"Clear",
			),
		),
	);
}

/** `Status is Todo, In Progress ×` — every part of it interactive. */
function FilterChip(
	filter: Readable<Filter>,
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
) {
	const field = filter.get().field;
	const valueMenuOpen = signal(false);

	const summary = derived([filter, context], (current, ctx) => {
		const names = current.values.map((value) => labelOf(current.field, value, ctx));
		if (names.length <= 2) return names.join(", ");
		return `${names.length} ${FILTER_FIELD_LABELS[current.field].toLowerCase()}s`;
	});

	const setNegated = (negated: boolean) => {
		const current = filter.get();
		if (current.negated === negated) return;
		onChange(withFilter(filters.get(), { ...current, negated }));
	};

	return Div(
		{
			class:
				"flex h-6 items-center overflow-hidden rounded-md border border-border bg-secondary/50 text-[11px]",
		},

		Span({ class: "px-2 text-muted-foreground" }, FILTER_FIELD_LABELS[field]),

		DropdownMenu(
			DropdownMenuTrigger(
				{
					variant: "ghost",
					size: "sm",
					class: "h-6 rounded-none border-x border-border px-2 text-[11px] font-normal",
					title: "Choose is or is not",
				},
				filter.bind((current) => operatorLabel(current)),
			),
			DropdownMenuContent(
				{ class: "min-w-28", align: "start" },
				DropdownMenuItem(
					{ onSelect: () => setNegated(false) },
					"is",
					If(
						filter.bind((current) => !current.negated),
						Check({ class: "ml-auto size-3.5 shrink-0 text-primary" }),
					),
				),
				DropdownMenuItem(
					{ onSelect: () => setNegated(true) },
					"is not",
					If(
						filter.bind((current) => current.negated),
						Check({ class: "ml-auto size-3.5 shrink-0 text-primary" }),
					),
				),
			),
		),

		Popover(
			{ open: valueMenuOpen },
			PopoverTrigger(
				{
					variant: "ghost",
					size: "sm",
					class: "h-6 gap-1 rounded-none px-2 text-[11px] font-normal",
				},
				// Rebuilt whenever the values change — the icons are real nodes, so
				// they cannot simply be bound to.
				Dynamic([filter, context], (current, ctx) =>
					Div({ class: "flex items-center gap-0.5" }, ...iconsFor(current, ctx)),
				),
				summary,
			),
			PopoverContent(
				{ class: "w-64 p-0", align: "start" },
				ValueStep(field, filters, context, onChange, valueMenuOpen),
			),
		),

		Button(
			{
				variant: "ghost",
				size: "icon-xs",
				class: "h-6 w-6 rounded-none text-muted-foreground",
				title: "Remove filter",
				onClick: () => onChange(removeField(filters.get(), field)),
			},
			X({ class: "size-3" }),
		),
	);
}

/**
 * The add-filter dropdown: hover a dimension to open its values beside it.
 *
 * Submenus open on hover after the primitive's `openDelay` (100ms), or with
 * ArrowRight / Enter / Space. The checkbox keeps the menu open; the row closes it.
 */
export function AddFilterButton(
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
	variant: "primary" | "subtle" = "primary",
) {
	return DropdownMenu(
		{ open },
		DropdownMenuTrigger(
			{
				variant: "ghost",
				size: "sm",
				class:
					variant === "primary"
						? "h-7 gap-1.5 border border-border px-2 text-[12px]"
						: "h-6 gap-1 px-2 text-[11px] text-muted-foreground",
			},
			ListFilter({ class: variant === "primary" ? "size-3.5" : "size-3" }),
			variant === "primary" ? "Filter" : "Add filter",
		),
		DropdownMenuContent(
			{ class: "w-44", align: "start" },
			ForEach(
				context.bind((ctx) => availableFields(ctx).map((field) => ({ field }))),
				(entry) => entry.field,
				(entry) => FieldSubmenu(entry.get().field, filters, context, onChange),
			),
		),
	);
}

function FieldSubmenu(
	field: FilterField,
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
) {
	const { selected, sync } = bindFilterValues(filters, field, onChange);

	return DropdownMenuSub(
		DropdownMenuSubTrigger(FILTER_FIELD_LABELS[field]),
		DropdownMenuSubContent(
			{ class: "max-h-72 w-56 overflow-y-auto", align: "start" },
			...sync,
			DropdownMenuCheckboxGroup(
				{ value: selected },
				DropdownMenuGroupHeading(FILTER_FIELD_LABELS[field]),
				ForEach(
					context.bind((ctx) => optionsFor(field, ctx)),
					(option) => option.value,
					(option) =>
						DropdownMenuCheckboxItem(
							{
								value: option.get().value,
								indicator: MenuCheckbox(selected, option.get().value),
							},
							option.get().icon ?? null,
							Span({ class: "flex-1 truncate" }, option.bind("label")),
						),
				),
			),
		),
	);
}

/**
 * The values for one dimension, multi-select and searchable.
 *
 * Same checkbox-or-row split as the add menu and the issue label picker. The
 * command input is extra, because a chip is often where you hunt through a
 * long member or label list.
 */
function ValueStep(
	field: FilterField,
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
) {
	const { selected, sync } = bindFilterValues(filters, field, onChange);

	return Div(
		{ class: "contents" },
		...sync,
		Command(
			{ label: FILTER_FIELD_LABELS[field] },
			CommandInput({ placeholder: `${FILTER_FIELD_LABELS[field]}…` }),
			CommandList(
				CommandEmpty("Nothing matches."),
				CommandGroup(
					CommandGroupItems(
						ForEach(
							context.bind((ctx) => optionsFor(field, ctx)),
							(option) => option.value,
							(option) =>
								CommandItem(
									{
										value: option.get().label,
										onSelect: () => {
											const id = option.get().value;
											selected.update((ids) =>
												ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id],
											);
											open.set(false);
										},
									},
									MenuCheckbox(selected, option.get().value),
									option.get().icon ?? null,
									Span({ class: "flex-1 truncate" }, option.bind("label")),
								),
						),
					),
				),
			),
		),
	);
}
