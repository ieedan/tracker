// The condition builder — "only deliver when the issue is labeled bug, or it
// is assigned to Claude".
//
// The tree it edits is the same one `domain/webhook-filters.ts` evaluates on
// the server, so what the preview line says here is literally what the delivery
// pipeline will decide. `webhook-builder.ts` holds the data model; this file is
// only the controls over it.
//
// A condition is a chip in the same shape as the issue filter bar's —
// `Field · operator · values ×`, every segment its own menu — because they are
// the same idea and should not be two different things to learn. Values come
// from the workspace wherever the workspace is what defines them: members,
// labels, teams and repositories are picked, never typed from memory. A typed
// value is still reachable for the cases a list cannot cover — a label nobody
// has created yet, an address that is not a member.
import {
	Div,
	Dynamic,
	ForEach,
	If,
	ImplementEffect,
	P,
	Span,
	derived,
	signal,
	type Child,
	type Mountable,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Check, Plus, Trash2, X } from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandGroupHeading,
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
import { Input } from "@/lib/components/ui/input";
import { MenuCheckbox } from "@/lib/components/ui/menu-checkbox";
import { CHIP_GLYPH, UserAvatar } from "@/lib/components/glyphs";
import {
	arityOf,
	fieldHasOptions,
	fieldsForEvents,
	filterField,
	MAX_FILTER_RULES,
	operatorsFor,
	OPERATOR_LABELS,
	type FilterField,
	type FilterMatch,
} from "@/lib/domain/webhook-filters";
import type { WebhookEvent } from "@/lib/domain/webhooks";
import type { Label, Member, Repository, Team } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import {
	countBuilderRules,
	describeBuilder,
	newCondition,
	newGroup,
	type BuilderCondition,
	type BuilderGroup,
	type BuilderNode,
} from "./webhook-builder";

/** The workspace's own values, for the fields whose options are its own. */
export interface ConditionCatalog {
	members: Member[];
	labels: Label[];
	teams: Team[];
	repositories: Repository[];
}

export const emptyCatalog = (): ConditionCatalog => ({
	members: [],
	labels: [],
	teams: [],
	repositories: [],
});

interface ConditionOption {
	value: string;
	label: string;
	icon?: Child;
}

/**
 * What a field offers: its own closed set, or the workspace's.
 *
 * Deduplicated by value because these are names — two members can share one,
 * and a duplicate would collide as a `ForEach` key.
 */
function optionsFor(
	field: FilterField | undefined,
	catalog: ConditionCatalog,
	compact = false,
): ConditionOption[] {
	const options = collectOptions(field, catalog, compact);
	const seen = new Set<string>();
	return options.filter((option) => {
		if (seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	});
}

function collectOptions(
	field: FilterField | undefined,
	catalog: ConditionCatalog,
	compact: boolean,
): ConditionOption[] {
	if (field === undefined) return [];
	if (field.options !== undefined) {
		return field.options.map((option) => ({ value: option.value, label: option.label }));
	}

	const avatar = compact ? CHIP_GLYPH.avatar : undefined;

	switch (field.source) {
		case "members":
			return catalog.members.map((member) => ({
				value: member.user.name,
				label: member.user.name,
				icon: UserAvatar(member.user, avatar),
			}));
		case "labels":
			return catalog.labels.map((label) => ({
				value: label.name,
				label: label.name,
				icon: Span({
					class: cn("shrink-0 rounded-full", compact ? CHIP_GLYPH.dot : "size-2.5"),
					style: { backgroundColor: label.color },
				}),
			}));
		case "teams":
			return catalog.teams.map((team) => ({
				value: team.key,
				label: team.name,
				icon: Span({ class: "shrink-0 font-mono text-[10px] text-muted-foreground" }, team.key),
			}));
		case "repositories":
			return catalog.repositories.map((repository) => ({
				value: repository.fullName,
				label: repository.fullName,
			}));
		default:
			return [];
	}
}

/** How a value reads on the chip — a team's name rather than its key. */
function labelOf(field: FilterField | undefined, value: string, catalog: ConditionCatalog): string {
	return optionsFor(field, catalog).find((option) => option.value === value)?.label ?? value;
}

/** Past a few, a row of glyphs is noise and the count says more. */
const MAX_CHIP_ICONS = 3;

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

/** Exactly the issue filter bar's chip, so the two read as one idea. */
const CHIP =
	"flex h-6 items-center overflow-hidden rounded-md border border-border bg-secondary/50 text-[11px]";
const SEGMENT = "h-6 rounded-none px-2 text-[11px] font-normal";

/**
 * `events` narrows the field picker: a webhook listening only for feedback has
 * no business being offered issue priorities.
 */
export function ConditionsEditor(
	match: Signal<FilterMatch>,
	rules: Signal<BuilderNode[]>,
	events: Readable<WebhookEvent[]>,
	catalog: Readable<ConditionCatalog>,
) {
	const fields = derived([events], (list) => fieldsForEvents(list));
	const full = derived([rules], (list) => countBuilderRules(list) >= MAX_FILTER_RULES);

	return Div(
		{ class: "flex flex-col gap-2" },
		Div(
			{ class: "flex items-center justify-between gap-2" },
			Span({ class: "text-[13px] font-medium" }, "Conditions"),
			If(
				rules.bind((list) => list.length > 0),
				MatchToggle(match),
			),
		),
		P(
			{ class: "text-[11px] text-muted-foreground" },
			rules.bind((list) =>
				list.length === 0
					? "Every subscribed event is delivered. Add a condition to narrow that down."
					: "Only events matching these are delivered.",
			),
		),

		If(
			rules.bind((list) => list.length > 0),
			Div(
				{ class: "flex flex-col gap-2 rounded-md border border-border p-2.5" },
				RuleList(match, rules, fields, catalog),
			),
		),

		Div(
			{ class: "flex flex-wrap items-center gap-1.5" },
			Button(
				{
					size: "xs",
					variant: "outline",
					type: "button",
					class: "gap-1 text-[11px]",
					disabled: full,
					onClick: () => rules.push(newCondition(fields.get())),
				},
				Plus({ class: "size-3" }),
				"Add condition",
			),
			Button(
				{
					size: "xs",
					variant: "ghost",
					type: "button",
					class: "gap-1 text-[11px] text-muted-foreground",
					disabled: full,
					onClick: () =>
						// The opposite of the outer match: a group inside an "all" is
						// there to hold an "or", and the other way round.
						rules.push(newGroup(fields.get(), match.get() === "all" ? "any" : "all")),
				},
				Plus({ class: "size-3" }),
				"Add group",
			),
			If(
				full,
				Span(
					{ class: "text-[11px] text-muted-foreground" },
					`${MAX_FILTER_RULES} conditions is the limit`,
				),
			),
		),

		Preview(match, rules),
	);
}

/** The rows of one group, with the and/or word standing between them. */
function RuleList(
	match: Readable<FilterMatch>,
	rules: Signal<BuilderNode[]>,
	fields: Readable<FilterField[]>,
	catalog: Readable<ConditionCatalog>,
): Mountable {
	const remove = (id: string) => rules.update((list) => list.filter((rule) => rule.id !== id));

	return ForEach(
		rules,
		(rule) => rule.id,
		(rule, index) =>
			Div(
				{ class: "flex flex-wrap items-center gap-1.5" },
				Span(
					{
						class: index.bind((position) =>
							cn(
								"w-7 shrink-0 text-right text-[11px] font-medium text-muted-foreground",
								position === 0 && "opacity-0",
							),
						),
					},
					match.bind((mode) => (mode === "all" ? "and" : "or")),
				),
				rule.get().type === "group"
					? GroupRow(rule as Signal<BuilderGroup>, fields, catalog, () => remove(rule.get().id))
					: ConditionChip(rule as Signal<BuilderCondition>, fields, catalog, () =>
							remove(rule.get().id),
						),
			),
	);
}

/**
 * A nested group — the `(A or B)` half of `(A or B) and C`.
 *
 * It offers no "Add group" of its own, which is what keeps the tree inside
 * `MAX_FILTER_DEPTH` without anything having to count levels.
 */
function GroupRow(
	group: Signal<BuilderGroup>,
	fields: Readable<FilterField[]>,
	catalog: Readable<ConditionCatalog>,
	onRemove: () => void,
): Mountable {
	return Div(
		{
			class:
				"flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-dashed border-border bg-muted/30 p-2",
		},
		Div(
			{ class: "flex items-center justify-between gap-2" },
			MatchToggle(group.bind("match")),
			Button(
				{
					size: "icon-xs",
					variant: "ghost",
					type: "button",
					title: "Remove group",
					onClick: onRemove,
				},
				Trash2({ class: "size-3" }),
			),
		),
		RuleList(group.bind("match"), group.bind("rules"), fields, catalog),
		Button(
			{
				size: "xs",
				variant: "ghost",
				type: "button",
				class: "gap-1 self-start text-[11px] text-muted-foreground",
				onClick: () => group.bind("rules").push(newCondition(fields.get())),
			},
			Plus({ class: "size-3" }),
			"Add condition",
		),
	);
}

/** All / any, as a two-button segmented control. */
function MatchToggle(match: Signal<FilterMatch>) {
	const option = (value: FilterMatch, label: string) =>
		Button(
			{
				size: "xs",
				variant: "ghost",
				type: "button",
				class: match.bind((current) =>
					cn(
						"h-6 rounded-none px-2 text-[11px]",
						current === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground",
					),
				),
				onClick: () => match.set(value),
			},
			label,
		);

	return Div(
		{ class: "flex items-center gap-1" },
		Span({ class: "text-[11px] text-muted-foreground" }, "Match"),
		Div(
			{ class: "flex overflow-hidden rounded-md border border-input bg-muted p-0.5" },
			option("all", "all"),
			option("any", "any"),
		),
	);
}

/** `Issue label includes bug ×` — every segment its own menu. */
function ConditionChip(
	condition: Signal<BuilderCondition>,
	fields: Readable<FilterField[]>,
	catalog: Readable<ConditionCatalog>,
	onRemove: () => void,
): Mountable {
	return Div(
		{ class: CHIP },
		FieldPicker(condition, fields),
		OperatorPicker(condition),
		ValueSegment(condition, catalog),
		Button(
			{
				variant: "ghost",
				size: "icon-xs",
				type: "button",
				class: "h-6 w-6 rounded-none text-muted-foreground",
				title: "Remove condition",
				onClick: onRemove,
			},
			X({ class: "size-3" }),
		),
	);
}

function FieldPicker(condition: Signal<BuilderCondition>, fields: Readable<FilterField[]>) {
	const open = signal(false);
	const search = signal("");
	const groups = derived([fields], (list) => [...new Set(list.map((field) => field.group))]);

	/**
	 * Changing the field can invalidate the operator — "includes" means nothing
	 * on a status. Keep it when the new kind still supports it, and fall back to
	 * that kind's first operator when it does not. Operands are dropped either
	 * way: they belonged to the old field.
	 */
	const pick = (key: string) => {
		const field = filterField(key);
		const operators = operatorsFor(field?.kind ?? "text");
		condition.update((current) => ({
			...current,
			field: key,
			operator: operators.includes(current.operator) ? current.operator : operators[0]!,
			value: "",
			values: [],
		}));
		open.set(false);
	};

	return Popover(
		{ open },
		PopoverTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(SEGMENT, "max-w-[10rem] text-muted-foreground"),
				title: "Choose what to match on",
			},
			Span(
				{ class: "truncate" },
				condition.bind((value) => filterField(value.field)?.label ?? value.field),
			),
		),
		PopoverContent(
			{ class: "w-64 p-0", align: "start" },
			ImplementEffect([open], (isOpen) => {
				if (!isOpen) search.set("");
			}),
			Command(
				{ label: "Condition field", search },
				CommandInput({ placeholder: "Match on…" }),
				CommandList(
					CommandEmpty("Nothing matches."),
					ForEach(
						groups,
						(group) => group,
						(group) =>
							CommandGroup(
								CommandGroupHeading(group.get()),
								CommandGroupItems(
									ForEach(
										derived([fields, group], (list, name) =>
											list.filter((field) => field.group === name),
										),
										(field) => field.key,
										(field) =>
											CommandItem(
												{
													value: field.get().label,
													onSelect: () => pick(field.get().key),
												},
												Span({ class: "flex-1 truncate" }, field.bind("label")),
												If(
													condition.bind((value) => value.field === field.get().key),
													Check({ class: "ml-auto size-3.5 shrink-0 text-primary" }),
												),
											),
									),
								),
							),
					),
				),
			),
		),
	);
}

function OperatorPicker(condition: Signal<BuilderCondition>) {
	const operators = condition.bind((value) => [
		...operatorsFor(filterField(value.field)?.kind ?? "text"),
	]);

	return DropdownMenu(
		DropdownMenuTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(SEGMENT, "border-x border-border"),
				title: "Choose how to compare",
			},
			condition.bind((value) => OPERATOR_LABELS[value.operator]),
		),
		DropdownMenuContent(
			{ class: "min-w-40", align: "start" },
			ForEach(
				operators,
				(operator) => operator,
				(operator) =>
					DropdownMenuItem(
						{
							onSelect: () => {
								const next = operator.get();
								// Switching between one operand and many keeps whatever is
								// already picked; the reverse trims to the first, which is
								// what `fromBuilder` would have done anyway.
								condition.update((current) =>
									arityOf(next) === "one" && current.values.length > 1
										? { ...current, operator: next, values: current.values.slice(0, 1) }
										: { ...current, operator: next },
								);
							},
						},
						Span(
							{ class: "flex-1" },
							operator.bind((value) => OPERATOR_LABELS[value]),
						),
						If(
							condition.bind((value) => value.operator === operator.get()),
							Check({ class: "ml-auto size-3.5 shrink-0 text-primary" }),
						),
					),
			),
		),
	);
}

/**
 * The operand segment: nothing, a picker, or a text box.
 *
 * Which one is decided by the field and the operator, so it is rebuilt only
 * when *that* changes — rebuilding on every keystroke would make the text box
 * steal its own focus.
 */
function ValueSegment(condition: Signal<BuilderCondition>, catalog: Readable<ConditionCatalog>) {
	const shape = condition.bind((value) => {
		const field = filterField(value.field);
		return `${value.field}:${arityOf(value.operator)}:${fieldHasOptions(field) ? "picked" : "free"}`;
	});

	return Dynamic([shape], () => {
		const current = condition.get();
		const field = filterField(current.field);
		const arity = arityOf(current.operator);

		if (arity === "none") return null;
		if (fieldHasOptions(field)) return ValuePicker(condition, catalog, arity === "many");

		return Div(
			{ class: "border-l border-border" },
			Input({
				value: condition.bind("value"),
				placeholder:
					arity === "many"
						? "one, two — comma separated"
						: field?.kind === "number"
							? "42"
							: "value",
				"aria-label": "Condition value",
				class:
					"h-6 w-40 rounded-none border-0 bg-transparent px-2 text-[11px] shadow-none focus-visible:ring-0",
			}),
		);
	});
}

/** The workspace's own values, searchable, with a way out for anything new. */
function ValuePicker(
	condition: Signal<BuilderCondition>,
	catalog: Readable<ConditionCatalog>,
	multiple: boolean,
) {
	const open = signal(false);
	const search = signal("");
	const values = condition.bind("values");

	const field = derived([condition], (current) => filterField(current.field));
	const options = derived([field, catalog], (current, list) =>
		optionsFor(current, list).map((option) => ({ ...option, key: option.value })),
	);

	const toggle = (value: string) => {
		if (!multiple) {
			values.set([value]);
			open.set(false);
			return;
		}
		values.update((picked) =>
			picked.includes(value) ? picked.filter((entry) => entry !== value) : [...picked, value],
		);
	};

	const summary = derived([condition, catalog], (current, list) => {
		const picked = current.values;
		if (picked.length === 0) return "Choose…";
		const resolved = filterField(current.field);
		if (picked.length <= 2) {
			return picked.map((value) => labelOf(resolved, value, list)).join(", ");
		}
		return `${picked.length} selected`;
	});

	return Popover(
		{ open },
		PopoverTrigger(
			{
				variant: "ghost",
				size: "sm",
				class: cn(SEGMENT, "gap-1 border-l border-border"),
				title: "Choose the value",
			},
			// Real nodes rather than text, so they are rebuilt rather than bound.
			Dynamic([condition, catalog], (current, list) => {
				if (current.values.length === 0 || current.values.length > MAX_CHIP_ICONS) return null;
				const resolved = optionsFor(filterField(current.field), list, true);
				const icons = current.values
					.map((value) => resolved.find((option) => option.value === value)?.icon)
					.filter((icon): icon is Child => icon !== undefined && icon !== null);
				return Div({ class: "flex items-center gap-0.5" }, ...icons);
			}),
			Span(
				{
					class: condition.bind((current) =>
						cn("truncate", current.values.length === 0 && "text-muted-foreground"),
					),
				},
				summary,
			),
		),
		PopoverContent(
			{ class: "w-64 p-0", align: "start" },
			ImplementEffect([open], (isOpen) => {
				if (!isOpen) search.set("");
			}),
			Command(
				{ label: "Condition value", search },
				CommandInput({ placeholder: "Search…" }),
				CommandList(
					// The list is what the workspace has; it is not the limit of what a
					// rule may say. A label that does not exist yet still needs to be
					// expressible, and typing it is how.
					CommandEmpty(
						Div(
							{ class: "px-1 py-1" },
							Button(
								{
									size: "sm",
									variant: "ghost",
									type: "button",
									class: "h-7 w-full justify-start gap-1.5 text-[12px] font-normal",
									onClick: () => {
										const typed = search.get().trim();
										if (typed !== "") toggle(typed);
										open.set(false);
									},
								},
								Plus({ class: "size-3.5 shrink-0" }),
								Span(
									{ class: "truncate" },
									search.bind((typed) => `Use "${typed.trim()}"`),
								),
							),
						),
					),
					CommandGroup(
						CommandGroupItems(
							ForEach(
								options,
								(option) => option.key,
								(option) =>
									CommandItem(
										{
											value: option.get().label,
											onSelect: () => toggle(option.get().value),
										},
										multiple ? MenuCheckbox(values, option.get().value) : null,
										option.get().icon ?? null,
										Span({ class: "flex-1 truncate" }, option.bind("label")),
										multiple
											? null
											: If(
													values.bind((picked) => picked.includes(option.get().value)),
													Check({ class: "ml-auto size-3.5 shrink-0 text-primary" }),
												),
									),
							),
						),
					),
				),
			),
		),
	);
}

/** What the saved tree will read as, in the same words the settings list shows. */
function Preview(match: Readable<FilterMatch>, rules: Readable<BuilderNode[]>) {
	const summary = derived([match, rules], (mode, list) => describeBuilder(mode, list));

	return If(
		summary.bind((text) => text !== ""),
		P(
			{ class: "rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground" },
			Span({ class: "font-medium text-foreground" }, "Delivers when "),
			summary,
		),
	);
}
