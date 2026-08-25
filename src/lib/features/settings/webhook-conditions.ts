// The condition builder — "only deliver when the issue is labeled bug, or it
// is assigned to Claude".
//
// The tree it edits is the same one `domain/webhook-filters.ts` evaluates on
// the server, so what the preview line says here is literally what the delivery
// pipeline will decide. `webhook-builder.ts` holds the data model; this file is
// only the controls over it.
//
// Editing is plain data in a signal, not a graph of nested components: `ForEach`
// hands each row a writable view of its own node, and writing to it lands back
// in the array. Dropdowns keep a small local signal synced to that node, the way
// the issue pickers do.
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
	type Mountable,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ChevronDownIcon, Plus, Trash2 } from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
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
import { Input } from "@/lib/components/ui/input";
import { MenuCheckbox } from "@/lib/components/ui/menu-checkbox";
import {
	arityOf,
	fieldsForEvents,
	filterField,
	MAX_FILTER_RULES,
	operatorsFor,
	OPERATOR_LABELS,
	type FilterField,
	type FilterMatch,
	type FilterOperator,
} from "@/lib/domain/webhook-filters";
import type { WebhookEvent } from "@/lib/domain/webhooks";
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

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

const triggerClass =
	"inline-flex h-8 min-w-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-[12px] font-normal text-foreground hover:bg-accent";

const inputClass = "h-8 min-w-0 flex-1 px-2 text-[12px] shadow-none";

/**
 * `events` narrows the field picker: a webhook listening only for feedback has
 * no business being offered issue priorities.
 */
export function ConditionsEditor(
	match: Signal<FilterMatch>,
	rules: Signal<BuilderNode[]>,
	events: Readable<WebhookEvent[]>,
) {
	const fields = derived([events], (list) => fieldsForEvents(list));
	const full = derived([rules], (list) => countBuilderRules(list) >= MAX_FILTER_RULES);

	return Div(
		{ class: "flex flex-col gap-1.5" },
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
				{ class: "flex flex-col gap-1.5 rounded-md border border-border p-2" },
				RuleList(match, rules, fields),
			),
		),

		Div(
			{ class: "flex items-center gap-1.5" },
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
): Mountable {
	const remove = (id: string) => rules.update((list) => list.filter((rule) => rule.id !== id));

	return ForEach(
		rules,
		(rule) => rule.id,
		(rule, index) =>
			Div(
				{ class: "flex flex-col gap-1.5" },
				If(
					index.bind((position) => position > 0),
					Span(
						{ class: "px-0.5 text-[11px] font-medium text-muted-foreground" },
						match.bind((mode) => (mode === "all" ? "and" : "or")),
					),
				),
				rule.get().type === "group"
					? GroupRow(rule as Signal<BuilderGroup>, fields, () => remove(rule.get().id))
					: ConditionRow(rule as Signal<BuilderCondition>, fields, () => remove(rule.get().id)),
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
	onRemove: () => void,
): Mountable {
	return Div(
		{
			class: "flex flex-col gap-1.5 rounded-md border border-dashed border-border bg-muted/30 p-2",
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
		RuleList(group.bind("match"), group.bind("rules"), fields),
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

function ConditionRow(
	condition: Signal<BuilderCondition>,
	fields: Readable<FilterField[]>,
	onRemove: () => void,
) {
	/**
	 * Which value control to show. Derived so it only changes when the *shape*
	 * of the control does — typing into the text box must not remount it, or
	 * every keystroke would steal its own focus.
	 */
	const shape = condition.bind((value) => {
		const field = filterField(value.field);
		const options = field?.options === undefined ? "free" : "picked";
		return `${value.field}:${arityOf(value.operator)}:${options}`;
	});

	return Div(
		{ class: "flex flex-wrap items-center gap-1.5" },
		FieldPicker(condition, fields),
		OperatorPicker(condition),
		Dynamic([shape], () => ValueControl(condition)),
		Button(
			{
				size: "icon-xs",
				variant: "ghost",
				type: "button",
				class: "ml-auto text-muted-foreground",
				title: "Remove condition",
				onClick: onRemove,
			},
			Trash2({ class: "size-3" }),
		),
	);
}

function FieldPicker(condition: Signal<BuilderCondition>, fields: Readable<FilterField[]>) {
	const selected = signal<string | null>(condition.get().field);

	/**
	 * Changing the field can invalidate the operator — "includes" means nothing
	 * on a status. Keep it when the new kind still supports it, and fall back to
	 * that kind's first operator when it does not.
	 */
	const pick = (key: string) => {
		const field = filterField(key);
		const operators = operatorsFor(field?.kind ?? "text");
		condition.update((current) => ({
			...current,
			field: key,
			operator: operators.includes(current.operator) ? current.operator : operators[0]!,
			// Values belong to the old field's options; text is often still useful.
			values: [],
		}));
	};

	const groups = derived([fields], (list) => [...new Set(list.map((field) => field.group))]);

	return DropdownMenu(
		{},
		ImplementEffect([condition], (value) => selected.set(value.field)),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, "max-w-[11rem]") },
			Span(
				{ class: "truncate" },
				condition.bind((value) => filterField(value.field)?.label ?? value.field),
			),
			ChevronDownIcon({ class: "size-3 shrink-0 opacity-50" }),
		),
		DropdownMenuContent(
			{ class: "w-64", align: "start", search: "Filter on…" },
			DropdownMenuRadioGroup(
				{
					value: selected,
					onValueChange: (key) => {
						if (typeof key === "string") pick(key);
					},
				},
				ForEach(
					groups,
					(group) => group,
					(group) =>
						Div(
							{},
							DropdownMenuGroupHeading(group.bind((name) => name)),
							ForEach(
								derived([fields, group], (list, name) =>
									list.filter((field) => field.group === name),
								),
								(field) => field.key,
								(field) =>
									DropdownMenuRadioItem(
										{ value: field.get().key, label: field.get().label },
										Span({ class: "flex-1 truncate" }, field.bind("label")),
									),
							),
						),
				),
			),
		),
	);
}

function OperatorPicker(condition: Signal<BuilderCondition>) {
	const selected = signal<string | null>(condition.get().operator);
	const operators = condition.bind((value) => [
		...operatorsFor(filterField(value.field)?.kind ?? "text"),
	]);

	return DropdownMenu(
		{},
		ImplementEffect([condition], (value) => selected.set(value.operator)),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: triggerClass },
			Span(
				{ class: "truncate" },
				condition.bind((value) => OPERATOR_LABELS[value.operator]),
			),
			ChevronDownIcon({ class: "size-3 shrink-0 opacity-50" }),
		),
		DropdownMenuContent(
			{ class: "w-52", align: "start" },
			DropdownMenuRadioGroup(
				{
					value: selected,
					onValueChange: (operator) => {
						if (typeof operator !== "string") return;
						condition.bind("operator").set(operator as FilterOperator);
					},
				},
				ForEach(
					operators,
					(operator) => operator,
					(operator) =>
						DropdownMenuRadioItem(
							{ value: operator.get(), label: OPERATOR_LABELS[operator.get()] },
							Span(
								{ class: "flex-1" },
								operator.bind((value) => OPERATOR_LABELS[value]),
							),
						),
				),
			),
		),
	);
}

/** The operand control: nothing, a text box, or a picker over the field's options. */
function ValueControl(condition: Signal<BuilderCondition>) {
	const current = condition.get();
	const field = filterField(current.field);
	const arity = arityOf(current.operator);

	if (arity === "none") return null;

	if (field?.options !== undefined) {
		return arity === "many" ? OptionsMulti(condition, field) : OptionsSingle(condition, field);
	}

	return Input({
		value: condition.bind("value"),
		placeholder:
			arity === "many"
				? "bug, regression — comma separated"
				: field?.kind === "number"
					? "42"
					: "value",
		class: inputClass,
		"aria-label": "Condition value",
	});
}

function OptionsSingle(condition: Signal<BuilderCondition>, field: FilterField) {
	const options = field.options ?? [];
	const selected = signal<string | null>(condition.get().values[0] ?? null);

	return DropdownMenu(
		{},
		ImplementEffect([condition], (value) => selected.set(value.values[0] ?? null)),
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, "min-w-[8rem] flex-1") },
			Span(
				{ class: "truncate" },
				condition.bind((value) => {
					const picked = value.values[0];
					if (picked === undefined) return "Choose…";
					return options.find((option) => option.value === picked)?.label ?? picked;
				}),
			),
			ChevronDownIcon({ class: "size-3 shrink-0 opacity-50" }),
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: options.length > 8 ? "Choose…" : undefined },
			DropdownMenuRadioGroup(
				{
					value: selected,
					onValueChange: (picked) => {
						if (typeof picked !== "string") return;
						condition.bind("values").set([picked]);
					},
				},
				...options.map((option) =>
					DropdownMenuRadioItem(
						{ value: option.value, label: option.label },
						Span({ class: "flex-1 truncate" }, option.label),
					),
				),
			),
		),
	);
}

function OptionsMulti(condition: Signal<BuilderCondition>, field: FilterField) {
	const options = field.options ?? [];
	const values = condition.bind("values");

	return DropdownMenu(
		{},
		DropdownMenuTrigger(
			{ variant: "ghost", size: "sm", class: cn(triggerClass, "min-w-[8rem] flex-1") },
			Span(
				{ class: "truncate" },
				values.bind((picked) => {
					if (picked.length === 0) return "Choose…";
					if (picked.length === 1) {
						const only = picked[0]!;
						return options.find((option) => option.value === only)?.label ?? only;
					}
					return `${picked.length} selected`;
				}),
			),
			ChevronDownIcon({ class: "size-3 shrink-0 opacity-50" }),
		),
		DropdownMenuContent(
			{ class: "w-56", align: "start", search: options.length > 8 ? "Choose…" : undefined },
			DropdownMenuCheckboxGroup(
				{ value: values },
				...options.map((option) =>
					DropdownMenuCheckboxItem(
						{
							value: option.value,
							label: option.label,
							indicator: MenuCheckbox(values, option.value),
						},
						Span({ class: "flex-1 truncate" }, option.label),
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
			{ class: "rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground" },
			Span({ class: "font-medium text-foreground" }, "Delivers when "),
			summary,
		),
	);
}
