/**
 * The filter bar, in Linear's shape.
 *
 * Two moving parts:
 *
 *   - **Add menu** — a two-step dropdown. Pick a dimension (Status, Assignee, …),
 *     then pick values from it. Both steps are searchable; the value step is
 *     multi-select and stays open so several can be ticked in a row.
 *   - **Chips** — one per active filter, reading `Status is Todo, In Progress`.
 *     The operator toggles `is` / `is not` on click, the values reopen the same
 *     value step, and the × removes the filter.
 *
 * Filters themselves live in the URL — see `filters.ts`. Nothing here holds
 * filter state; every interaction hands a new list up to `onChange`.
 */
import {
	Div,
	Dynamic,
	ForEach,
	If,
	Span,
	derived,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Check, ChevronLeft, ListFilter, X } from "@implementjs/lucide";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandGroupItems,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/components/ui/popover";
import { Button } from "@/lib/components/ui/button";
import { PriorityIcon, StatusIcon, UnassignedAvatar, UserAvatar } from "@/lib/components/glyphs";
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
	toggleValue,
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

/**
 * Glyph sizes differ by where they are shown. In the menu they sit beside 13px
 * rows and match the issue list; in a 24px chip that same 20px avatar all but
 * fills it, so chips get their own smaller set.
 *
 * `cn` runs these through tailwind-merge, so a `size-*` here beats the one baked
 * into the glyph. The status ring additionally needs the `[&_svg]:` variant —
 * its markup carries width/height attributes, and only CSS overrides those.
 */
const COMPACT = {
	status: "size-3.5 [&_svg]:size-3.5",
	avatar: "size-3.5 text-[8px]",
	dot: "size-2",
} as const;

function optionsFor(field: FilterField, context: FilterContext, compact = false): FilterOption[] {
	const avatar = compact ? COMPACT.avatar : undefined;

	switch (field) {
		case "status":
			return ISSUE_STATUSES.map((status) => ({
				value: status,
				label: STATUS_LABELS[status],
				icon: StatusIcon(status, compact ? COMPACT.status : undefined),
			}));
		case "priority":
			return ISSUE_PRIORITIES.map((priority) => ({
				value: priority,
				label: PRIORITY_LABELS[priority],
				// The priority bars are fixed heights rather than one box, so they
				// shrink by scaling instead of by a size class.
				icon: PriorityIcon(priority, compact ? "scale-90" : undefined),
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
					class: cn("shrink-0 rounded-full", compact ? COMPACT.dot : "size-2.5"),
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

// ---------------------------------------------------------------------------

export interface FilterBarProps {
	filters: Readable<Filter[]>;
	context: Readable<FilterContext>;
	onChange: (next: Filter[]) => void;
}

export function FilterBar({ filters, context, onChange }: FilterBarProps) {
	// Its own open state: the header's button and this one are two separate
	// popovers, and sharing a signal opens both at once on top of each other.
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

	return Div(
		{
			class:
				"flex h-6 items-center overflow-hidden rounded-md border border-border bg-secondary/50 text-[11px]",
		},

		Span({ class: "px-2 text-muted-foreground" }, FILTER_FIELD_LABELS[field]),

		// The operator is the toggle: one click flips include ⇄ exclude.
		Button(
			{
				variant: "ghost",
				size: "sm",
				class: "h-6 rounded-none border-x border-border px-2 text-[11px] font-normal",
				title: "Switch between is and is not",
				onClick: () => {
					const current = filter.get();
					onChange(withFilter(filters.get(), { ...current, negated: !current.negated }));
				},
			},
			filter.bind((current) => operatorLabel(current)),
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
 * The add-filter dropdown: dimensions, then that dimension's values.
 *
 * `step` is null on the first screen and a field on the second. Reset when the
 * popover closes so it always reopens at the top.
 */
export function AddFilterButton(
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
	variant: "primary" | "subtle" = "primary",
) {
	const step = signal<FilterField | null>(null);

	open.onChange((isOpen) => {
		if (!isOpen) step.set(null);
	});

	return Popover(
		{ open },
		PopoverTrigger(
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
		PopoverContent(
			{ class: "w-64 p-0", align: "start" },
			// Two screens in one popover; `Dynamic` would remount the Command and
			// lose focus, so both are mounted and one is shown.
			If(step.bind((current) => current === null))
				.Then(FieldStep(context, step))
				.Else(
					Div(
						{ class: "contents" },
						...FILTER_FIELDS.map((field) =>
							If(
								step.bind((current) => current === field),
								Div(
									{ class: "contents" },
									BackRow(step, field),
									ValueStep(field, filters, context, onChange, open),
								),
							),
						),
					),
				),
		),
	);
}

function BackRow(step: Signal<FilterField | null>, field: FilterField) {
	return Div(
		{
			class:
				"flex h-8 items-center gap-1.5 border-b border-border px-2 text-[11px] text-muted-foreground",
		},
		Button(
			{
				variant: "ghost",
				size: "sm",
				class: "h-6 gap-1 px-1.5 text-[11px]",
				onClick: () => step.set(null),
			},
			ChevronLeft({ class: "size-3" }),
			"Back",
		),
		Span({ class: "font-medium text-foreground" }, FILTER_FIELD_LABELS[field]),
	);
}

/** Screen one: which dimension to filter on. */
function FieldStep(context: Readable<FilterContext>, step: Signal<FilterField | null>) {
	return Command(
		{ label: "Filter by" },
		CommandInput({ placeholder: "Filter…" }),
		CommandList(
			CommandEmpty("No matching filter."),
			CommandGroup(
				CommandGroupItems(
					ForEach(
						context.bind((ctx) => availableFields(ctx).map((field) => ({ field }))),
						(entry) => entry.field,
						(entry) =>
							CommandItem(
								{
									value: FILTER_FIELD_LABELS[entry.get().field],
									onSelect: () => step.set(entry.get().field),
								},
								Span({ class: "flex-1" }, FILTER_FIELD_LABELS[entry.get().field]),
							),
					),
				),
			),
		),
	);
}

/**
 * Screen two: the values for one dimension, multi-select.
 *
 * Shared with the chips, which is what makes editing a filter and creating one
 * the same interaction.
 */
function ValueStep(
	field: FilterField,
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
) {
	const current = derived([filters], (list) => list.find((filter) => filter.field === field));

	const pick = (value: string) => {
		const existing = current.get() ?? { field, negated: false, values: [] };
		onChange(withFilter(filters.get(), toggleValue(existing, value)));
		// Deliberately left open: picking several values in a row is the norm.
	};

	return Command(
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
									onSelect: () => pick(option.get().value),
								},
								option.get().icon ?? null,
								Span({ class: "flex-1 truncate" }, option.bind("label")),
								If(
									derived([current], (filter) =>
										(filter?.values ?? []).includes(option.get().value),
									),
									Check({ class: "size-3.5 shrink-0 text-primary" }),
								),
							),
					),
				),
			),
		),
		// Closing from inside the list is what Enter-then-Escape would do anyway;
		// this is the explicit affordance for "done picking".
		Div(
			{ class: "border-t border-border p-1" },
			Button(
				{
					variant: "ghost",
					size: "sm",
					class: "h-6 w-full justify-center text-[11px] text-muted-foreground",
					onClick: () => open.set(false),
				},
				"Done",
			),
		),
	);
}
