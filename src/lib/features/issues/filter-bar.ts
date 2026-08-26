/**
 * The filter bar, in Linear's shape.
 *
 * Two moving parts:
 *
 *   - **Add menu** — a dropdown of dimensions in front of a single values
 *     panel. Hovering a dimension opens its values beside it, the way the old
 *     submenus did; every dimension is one more trigger on that same panel, so
 *     hovering a second one re-anchors what is already open instead of tearing
 *     a panel down and building another: nothing unmounts, nothing animates,
 *     only the rows change. Values use the same checkbox-or-row pattern as the
 *     issue label picker — the box keeps the panel open so several can be
 *     ticked, the rest of the row toggles and closes.
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
	Fragment,
	If,
	ImplementEffect,
	ImplementLifecycle,
	Span,
	derived,
	mediaQuery,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { DrawerCtx } from "@implementjs/primitives";
import {
	Check,
	ChevronRight,
	CircleUser,
	ListFilter,
	Tag,
	User,
	Users,
	X,
} from "@implementjs/lucide";
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
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/lib/components/ui/drawer";
import { RESPONSIVE_DIALOG_QUERY } from "@/lib/components/ui/responsive-dialog";
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

/** The glyph for a filter *type* — not a value — so the add menu is scannable. */
function iconForField(field: FilterField): Child {
	switch (field) {
		case "status":
			return StatusIcon("todo", CHIP_GLYPH.status);
		case "priority":
			return PriorityIcon("none", CHIP_GLYPH.priority);
		case "assignee":
			return User({ class: CHIP_GLYPH.icon, "aria-hidden": true });
		case "creator":
			return CircleUser({ class: CHIP_GLYPH.icon, "aria-hidden": true });
		case "label":
			return Tag({ class: CHIP_GLYPH.icon, "aria-hidden": true });
		case "team":
			return Users({ class: CHIP_GLYPH.icon, "aria-hidden": true });
	}
}

function valuesOf(list: Filter[], field: FilterField): string[] {
	return list.find((filter) => filter.field === field)?.values ?? [];
}

function sameIds(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	const set = new Set(left);
	return right.every((id) => set.has(id));
}

/**
 * A writable copy of the active field's values, kept in lockstep with the URL.
 *
 * The command list needs a signal it can write; filters themselves are derived
 * from the query string. Equality guards stop the two effects from echoing each
 * other — and they are what makes swapping the field free, because the copy is
 * rewritten from the new field before the write-back effect ever looks at it.
 */
function bindFilterValues(
	filters: Readable<Filter[]>,
	field: Readable<FilterField | null>,
	onChange: (next: Filter[]) => void,
): { selected: Signal<string[]>; sync: Child[] } {
	const valuesFor = (list: Filter[], current: FilterField | null) =>
		current === null ? [] : valuesOf(list, current);

	const selected = signal(valuesFor(filters.get(), field.get()));

	return {
		selected,
		sync: [
			ImplementEffect([filters, field], (list, current) => {
				const next = valuesFor(list, current);
				if (!sameIds(selected.get(), next)) selected.set(next);
			}),
			ImplementEffect(
				[selected],
				(ids) => {
					const active = field.get();
					if (active === null) return;
					const current = valuesOf(filters.get(), active);
					if (sameIds(current, ids)) return;
					onChange(setFieldValues(filters.get(), active, ids));
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
	// A chip is one dimension for life; the panel below takes a signal because
	// the add menu drives the same component across all of them.
	const valueField = signal<FilterField | null>(field);

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

		// The values reopen as an anchored panel beside the chip, or as a bottom
		// drawer where there is no room to anchor one.
		If(mediaQuery(RESPONSIVE_DIALOG_QUERY))
			.Then(
				Div(
					{ class: "contents" },
					Button(
						{
							variant: "ghost",
							size: "sm",
							class: "h-6 gap-1 rounded-none px-2 text-[11px] font-normal",
							onClick: () => valueMenuOpen.set(true),
						},
						Dynamic([filter, context], (current, ctx) =>
							Div({ class: "flex items-center gap-0.5" }, ...iconsFor(current, ctx)),
						),
						summary,
					),
					Drawer(
						{ open: valueMenuOpen },
						DrawerContent(
							KeepKeyboardDown(),
							DrawerTitle({ class: "sr-only" }, FILTER_FIELD_LABELS[field]),
							DrawerDescription({ class: "sr-only" }, "Pick the values to filter by."),
							ValueStep(valueField, filters, context, onChange, valueMenuOpen),
						),
					),
				),
			)
			.Else(
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
						ValueStep(valueField, filters, context, onChange, valueMenuOpen),
					),
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

/** Distinguishes the panels when two filter menus share a page. */
let panelCount = 0;

/** The Filter / Add filter trigger, in its two sizes. */
const addTriggerClass = (variant: "primary" | "subtle") =>
	variant === "primary"
		? "h-7 gap-1.5 border border-border px-2 text-[12px]"
		: "h-6 gap-1 px-2 text-[11px] text-muted-foreground";

/**
 * Add a filter. A hover-driven dropdown-plus-side-panel where there is a
 * pointer to hover with, and a pair of nested bottom drawers where there is a
 * thumb instead — an anchored panel has nowhere to anchor on a phone.
 */
export function AddFilterButton(
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
	variant: "primary" | "subtle" = "primary",
) {
	const isMobile = mediaQuery(RESPONSIVE_DIALOG_QUERY);
	return If(isMobile)
		.Then(MobileAddFilter(filters, context, onChange, open, variant))
		.Else(DesktopAddFilter(filters, context, onChange, open, variant));
}

/**
 * Stops a just-opened values drawer from focusing its search box: the focus
 * trap's default is the first tabbable, which is the search input — and a
 * focused input pops the on-screen keyboard over the half-open sheet. The
 * panel takes the initial focus instead; tapping the field still brings the
 * keyboard up.
 */
function KeepKeyboardDown() {
	return DrawerCtx.Use((state) => {
		state.registerInitialFocus(state.contentElement);
		return Fragment();
	});
}

/**
 * The drawer flow: the first drawer lists the dimensions, tapping one stacks a
 * second drawer with that dimension's values — the same searchable multi-select
 * the desktop panel uses. The values drawer is mounted inside the first one, so
 * the modal layer treats it as nested and pushes the parent back behind it.
 */
function MobileAddFilter(
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
	variant: "primary" | "subtle",
) {
	const activeField = signal<FilterField | null>(null);
	const valuesOpen = signal(false);

	return Div(
		{ class: "contents" },
		Button(
			{
				variant: "ghost",
				size: "sm",
				class: addTriggerClass(variant),
				onClick: () => open.set(true),
			},
			ListFilter({ class: variant === "primary" ? "size-3.5" : "size-3" }),
			variant === "primary" ? "Filter" : "Add filter",
		),
		Drawer(
			{ open },
			// closing the dimension list takes the values drawer with it
			ImplementEffect([open], (isOpen) => {
				if (!isOpen) valuesOpen.set(false);
			}),
			DrawerContent(
				DrawerTitle({ class: "sr-only" }, "Add filter"),
				DrawerDescription({ class: "sr-only" }, "Pick what to filter the list by."),
				Div(
					{ class: "flex flex-col gap-0.5 px-2 pb-2" },
					ForEach(
						context.bind((ctx) => availableFields(ctx).map((field) => ({ field }))),
						(entry) => entry.field,
						(entry) =>
							Button(
								{
									variant: "ghost",
									class: "h-11 w-full justify-start gap-2.5 px-3 text-[14px] font-normal",
									onClick: () => {
										activeField.set(entry.get().field);
										valuesOpen.set(true);
									},
								},
								iconForField(entry.get().field),
								Span(
									{ class: "flex-1 truncate text-left" },
									FILTER_FIELD_LABELS[entry.get().field],
								),
								ChevronRight({
									class: "size-4 shrink-0 text-muted-foreground",
									"aria-hidden": true,
								}),
							),
					),
				),

				Drawer(
					{ open: valuesOpen },
					DrawerContent(
						KeepKeyboardDown(),
						DrawerTitle(
							{ class: "sr-only" },
							activeField.bind((field) => (field === null ? "Values" : FILTER_FIELD_LABELS[field])),
						),
						DrawerDescription({ class: "sr-only" }, "Pick the values to filter by."),
						ValueStep(activeField, filters, context, onChange, valuesOpen),
					),
				),
			),
		),
	);
}

/**
 * The add-filter dropdown: one values panel, one trigger per dimension.
 *
 * The dimensions used to nest a submenu each, which meant six panels built and
 * positioned up front and a teardown-plus-rebuild every time the pointer moved
 * one row. They are triggers on a single popover now: only the dimension being
 * looked at has rows in the DOM, and moving between dimensions re-anchors the
 * panel that is already open rather than opening another one. Hovering is still
 * all it takes to open one — see `FieldTrigger`.
 */
function DesktopAddFilter(
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
	variant: "primary" | "subtle",
) {
	// What the shared panel is showing. The popover tracks what it is anchored
	// *to*; this is what it is anchored *for*.
	const activeField = signal<FilterField | null>(null);
	const valuesOpen = signal(false);
	const panel = `filter-values-${(panelCount += 1)}`;

	// Set for the length of a handover, and only a handover. The panel is placed
	// by writing `left`/`top`, which nothing transitions by default — so the move
	// from one row to the next is a jump you cannot see. This flag turns those
	// two properties into animated ones just long enough to watch the panel
	// travel, then takes it back off: the first open is placed before the panel
	// fades in, and `autoUpdate` rewrites the same properties on every scroll, so
	// leaving the transition on would drag the panel around the screen.
	const sliding = signal(false);
	let slideTimer: ReturnType<typeof setTimeout> | null = null;
	const slide = () => {
		sliding.set(true);
		if (slideTimer !== null) clearTimeout(slideTimer);
		slideTimer = setTimeout(() => {
			slideTimer = null;
			sliding.set(false);
		}, HANDOVER_SLIDE_MS + 80);
	};

	return ImplementLifecycle(
		{
			onUnmount: () => {
				if (slideTimer !== null) clearTimeout(slideTimer);
			},
		},
		DropdownMenu(
			{ open },
			DropdownMenuTrigger(
				{
					variant: "ghost",
					size: "sm",
					class: addTriggerClass(variant),
				},
				ListFilter({ class: variant === "primary" ? "size-3.5" : "size-3" }),
				variant === "primary" ? "Filter" : "Add filter",
			),
			DropdownMenuContent(
				{ class: "w-44", align: "start" },
				// the panel is declared inside the menu, so closing the menu has to
				// take it with it
				ImplementEffect([open], (menuOpen) => {
					if (!menuOpen) valuesOpen.set(false);
				}),
				Popover(
					{ open: valuesOpen },
					ForEach(
						context.bind((ctx) => availableFields(ctx).map((field) => ({ field }))),
						(entry) => entry.field,
						(entry) =>
							FieldTrigger(
								entry.get().field,
								`${panel}-${entry.get().field}`,
								activeField,
								valuesOpen,
								slide,
							),
					),
					PopoverContent(
						{
							class: cn(
								"w-56 p-0",
								"data-[sliding=true]:transition-[left,top] data-[sliding=true]:duration-150",
								"data-[sliding=true]:ease-out motion-reduce:data-[sliding=true]:transition-none",
							),
							"data-sliding": sliding.bind((moving) => (moving ? "true" : undefined)),
							side: "right",
							align: "start",
							offset: 8,
							// Keys typed in here belong to the panel. Left to bubble they
							// reach the menu above, whose first-letter typeahead answers by
							// pulling focus back onto a row mid-word. Escape is the one key
							// that still has to get out, to the layer that dismisses this.
							onKeydown: (event: KeyboardEvent) => {
								if (event.key !== "Escape") event.stopPropagation();
							},
						},
						ValueStep(activeField, filters, context, onChange, valuesOpen),
					),
				),
			),
		),
	);
}

/**
 * How long the pointer has to rest on a row before the *first* panel opens. It
 * is what stops a pointer travelling from the Filter button down to the row it
 * wants from dragging a panel open behind it on the way.
 *
 * It applies to the first open only. Once a panel is open the next row takes it
 * over on the spot — re-anchoring costs a `computePosition` and two style
 * writes, measured at 1–2ms, so there is nothing here worth waiting for and a
 * wait is exactly what stops the panel reading as following the pointer.
 */
const HOVER_OPEN_DELAY = 60;

/** How long the panel takes to travel between rows. Matches the CSS duration. */
const HANDOVER_SLIDE_MS = 150;

/**
 * One row of the add menu, and one more trigger on the shared panel.
 *
 * Hovering opens the panel against this row, as the submenu it replaced did;
 * clicking opens it without the wait. Moving on to a sibling hands the same
 * panel over instantly — it re-anchors and swaps its rows, so there is no
 * close and no second panel, and the move itself is animated so the panel can
 * be seen arriving.
 *
 * Opening means clicking the row, even when a hover asked for it: a click is
 * what tells the popover which of its triggers to anchor to, and going through
 * it is what makes the handover free. Every row but the anchored one reads
 * `data-state="closed"`, so this never re-clicks — and so never toggles shut —
 * the row already showing.
 */
function FieldTrigger(
	field: FilterField,
	id: string,
	activeField: Signal<FilterField | null>,
	open: Readable<boolean>,
	slide: () => void,
) {
	const show = () => activeField.set(field);

	let hoverTimer: ReturnType<typeof setTimeout> | null = null;
	const clearHoverTimer = () => {
		if (hoverTimer === null) return;
		clearTimeout(hoverTimer);
		hoverTimer = null;
	};

	/** Hand the panel to this row. Clicking is how the popover is told to. */
	const take = (row: HTMLElement) => {
		if (open.get()) slide();
		show();
		row.click();
	};

	return ImplementLifecycle(
		{ onUnmount: clearHoverTimer },
		PopoverTrigger(
			{
				id,
				variant: "ghost",
				size: "sm",
				role: "menuitem",
				// How the menu above finds its rows — the same attribute its own items
				// carry. Without it arrow keys, Home/End and typeahead have nothing to
				// walk, because these rows are the popover's parts rather than the
				// menu's.
				"data-dropdown-menu-item": "",
				class: cn(
					"h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-sm font-normal",
					"data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
				),
				// Swap the rows before the click re-anchors, so the panel is measured at
				// the size it is about to be.
				onPointerdown: show,
				onClick: show,
				// `pointermove` rather than `pointerenter`, so a row that was clicked
				// shut comes back the moment the pointer stirs over it again.
				onPointermove: (event: PointerEvent) => {
					if (event.pointerType !== "mouse") return;
					const row = event.currentTarget;
					if (!(row instanceof HTMLElement) || row.dataset.state === "open") return;
					// A panel is already up: it belongs to whichever row the pointer is
					// on, as of now. Waiting here is what made the handover read as lag.
					if (open.get()) {
						clearHoverTimer();
						take(row);
						return;
					}
					if (hoverTimer !== null) return;
					hoverTimer = setTimeout(() => {
						hoverTimer = null;
						take(row);
					}, HOVER_OPEN_DELAY);
				},
				onPointerleave: (event: PointerEvent) => {
					if (event.pointerType !== "mouse") return;
					clearHoverTimer();
				},
			},
			iconForField(field),
			Span({ class: "flex-1 truncate text-left" }, FILTER_FIELD_LABELS[field]),
			ChevronRight({ class: "size-3.5 shrink-0 text-muted-foreground", "aria-hidden": true }),
		),
	);
}

/**
 * The values for one dimension, multi-select and searchable.
 *
 * The dimension is a signal rather than a fixed field, so one instance serves
 * every trigger pointing at it: switching swaps the rows and leaves the input,
 * the panel and its position where they are. Same checkbox-or-row split as the
 * issue label picker — the box keeps the panel open, the rest of the row
 * toggles and closes.
 */
function ValueStep(
	field: Readable<FilterField | null>,
	filters: Readable<Filter[]>,
	context: Readable<FilterContext>,
	onChange: (next: Filter[]) => void,
	open: Signal<boolean>,
) {
	const { selected, sync } = bindFilterValues(filters, field, onChange);
	const search = signal("");

	// Keyed by dimension as well as value: assignees and creators are the same
	// people, and a stale row would otherwise survive the swap between them.
	const options = derived([field, context], (current, ctx) =>
		current === null
			? []
			: optionsFor(current, ctx).map((option) => ({
					...option,
					key: `${current}:${option.value}`,
				})),
	);

	return Div(
		{ class: "contents" },
		...sync,
		// a new dimension starts a new search
		ImplementEffect([field], () => search.set(""), { immediate: false }),
		Command(
			{ label: "Filter values", search },
			CommandInput({
				placeholder: field.bind((current) =>
					current === null ? "Search…" : `${FILTER_FIELD_LABELS[current]}…`,
				),
			}),
			CommandList(
				CommandEmpty("Nothing matches."),
				CommandGroup(
					CommandGroupItems(
						ForEach(
							options,
							(option) => option.key,
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
