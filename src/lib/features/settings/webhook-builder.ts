// The editing model behind the condition builder.
//
// Kept apart from the components so it stays plain data: this is what converts
// between the tree the API stores and the shape a form can edit, and it is
// testable without a DOM.
import {
	arityOf,
	describeFilter,
	filterField,
	operatorsFor,
	type FilterField,
	type FilterMatch,
	type FilterOperator,
	type FilterRule,
	type WebhookFilter,
} from "@/lib/domain/webhook-filters";

/**
 * The editing shape.
 *
 * Two things differ from the stored tree. Every node carries an `id`, because
 * `ForEach` needs a key that survives editing, and an operand is always held as
 * both a free-text `value` and a picked `values` — one control writes each, and
 * keeping them apart means switching operators does not throw away what was
 * typed.
 */
export interface BuilderCondition {
	id: string;
	type: "condition";
	field: string;
	operator: FilterOperator;
	/** What the text box holds. Comma-separated for the "any of" operators. */
	value: string;
	/** What the option checkboxes hold. */
	values: string[];
}

export interface BuilderGroup {
	id: string;
	type: "group";
	match: FilterMatch;
	rules: BuilderNode[];
}

export type BuilderNode = BuilderCondition | BuilderGroup;

let counter = 0;
const nextId = (): string => `rule-${(counter += 1)}`;

const DEFAULT_FIELD = "issue.labels";

export function newCondition(fields: FilterField[]): BuilderCondition {
	const field = fields.find((entry) => entry.key === DEFAULT_FIELD) ?? fields[0];
	const key = field?.key ?? DEFAULT_FIELD;
	const kind = field?.kind ?? "text";
	return {
		id: nextId(),
		type: "condition",
		field: key,
		operator: operatorsFor(kind)[0]!,
		value: "",
		values: [],
	};
}

/** A nested group, seeded with one condition so it is never born empty. */
export function newGroup(fields: FilterField[], match: FilterMatch): BuilderGroup {
	return { id: nextId(), type: "group", match, rules: [newCondition(fields)] };
}

// ---------------------------------------------------------------------------
// Conversion to and from what the API stores
// ---------------------------------------------------------------------------

const splitValues = (raw: string): string[] =>
	raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

export function toBuilder(filter: WebhookFilter | null): {
	match: FilterMatch;
	rules: BuilderNode[];
} {
	if (filter === null) return { match: "all", rules: [] };
	return { match: filter.match, rules: filter.rules.map(toBuilderNode) };
}

function toBuilderNode(rule: FilterRule): BuilderNode {
	if (rule.type === "group") {
		return { id: nextId(), type: "group", match: rule.match, rules: rule.rules.map(toBuilderNode) };
	}

	const list = rule.value === undefined ? [] : [rule.value].flat();
	const field = filterField(rule.field);
	const picked = field?.options !== undefined;

	return {
		id: nextId(),
		type: "condition",
		field: rule.field,
		operator: rule.operator,
		value: picked ? (list[0] ?? "") : list.join(", "),
		values: picked ? list : [],
	};
}

/** Null when nothing is configured — that is what "deliver everything" is. */
export function fromBuilder(match: FilterMatch, rules: BuilderNode[]): WebhookFilter | null {
	const converted = rules.map(fromBuilderNode).filter((rule): rule is FilterRule => rule !== null);
	if (converted.length === 0) return null;
	return { type: "group", match, rules: converted };
}

function fromBuilderNode(node: BuilderNode): FilterRule | null {
	if (node.type === "group") {
		const rules = node.rules
			.map(fromBuilderNode)
			.filter((rule): rule is FilterRule => rule !== null);
		// An empty group matches everything, so dropping it changes nothing and
		// keeps a group someone opened and abandoned out of the saved tree.
		return rules.length === 0 ? null : { type: "group", match: node.match, rules };
	}

	const arity = arityOf(node.operator);
	if (arity === "none") {
		return { type: "condition", field: node.field, operator: node.operator };
	}

	const field = filterField(node.field);
	const picked = field?.options !== undefined;

	if (arity === "many") {
		const values = picked ? node.values : splitValues(node.value);
		if (values.length === 0) return null;
		return { type: "condition", field: node.field, operator: node.operator, value: values };
	}

	const value = picked ? (node.values[0] ?? node.value) : node.value;
	if (value.trim() === "") return null;
	return { type: "condition", field: node.field, operator: node.operator, value: value.trim() };
}

/** The preview line, phrased exactly as the saved tree would read. */
export function describeBuilder(match: FilterMatch, rules: BuilderNode[]): string {
	return describeFilter(fromBuilder(match, rules));
}

export function countBuilderRules(rules: BuilderNode[]): number {
	return rules.reduce(
		(total, rule) => total + 1 + (rule.type === "group" ? countBuilderRules(rule.rules) : 0),
		0,
	);
}
