/**
 * Webhook conditions — the rules that decide whether a subscribed event is
 * actually worth sending.
 *
 * Subscribing to `issue.updated` means every edit to every issue in the
 * workspace. That is almost never what an integration wants: it wants "when an
 * issue is labeled `bug`", or "when one is assigned to Claude". A condition
 * tree narrows the subscription down to those without the receiver having to
 * take, and then discard, everything else.
 *
 * The evaluator is pure and lives in `domain/` deliberately: the server runs it
 * at enqueue time, and the builder in settings runs the *same* code to describe
 * and preview a rule. There is no second implementation to drift.
 */
import { FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from "./feedback";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_LABELS,
	STATUS_LABELS,
	type IssuePriority,
	type IssueStatus,
} from "./issues";
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type WebhookEvent } from "./webhooks";

/** Whether every rule in a group has to hold, or just one of them. */
export const FILTER_MATCHES = ["all", "any"] as const;
export type FilterMatch = (typeof FILTER_MATCHES)[number];

export const FILTER_OPERATORS = [
	"equals",
	"not_equals",
	"contains",
	"not_contains",
	"starts_with",
	"ends_with",
	"in",
	"not_in",
	"includes",
	"not_includes",
	"includes_any",
	"includes_all",
	"greater_than",
	"less_than",
	"is_set",
	"is_not_set",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterCondition {
	type: "condition";
	/** A key from `FILTER_FIELDS`. */
	field: string;
	operator: FilterOperator;
	/**
	 * The operand. A string for the one-operand operators, an array for the
	 * "any of" ones, and absent for `is_set` / `is_not_set`.
	 */
	value?: string | string[];
}

export interface FilterGroup {
	type: "group";
	match: FilterMatch;
	rules: FilterRule[];
}

export type FilterRule = FilterCondition | FilterGroup;

/** A webhook's whole condition tree. Null on a webhook that filters nothing. */
export type WebhookFilter = FilterGroup;

/**
 * Kept small on purpose. Two levels is `(A or B) and C`, which covers what
 * people actually build; deeper trees are unreadable in a builder and are a
 * sign the logic belongs in the receiver.
 */
export const MAX_FILTER_DEPTH = 2;
export const MAX_FILTER_RULES = 25;
export const MAX_FILTER_VALUES = 25;
export const MAX_FILTER_VALUE_LENGTH = 200;

// ---------------------------------------------------------------------------
// The field catalogue
// ---------------------------------------------------------------------------

/** How a field compares, which decides the operators offered for it. */
export type FilterKind = "text" | "enum" | "list" | "number";

export interface FilterOption {
	value: string;
	label: string;
}

/**
 * Where a field's values come from when they are the workspace's own — its
 * members, labels, teams or repositories.
 *
 * These cannot be a fixed `options` list: they differ per workspace and change
 * while a rule exists. The builder resolves them against the workspace and
 * offers them as a picker; validation stays permissive, so a label that does
 * not exist yet is still expressible.
 */
export const FILTER_SOURCES = ["members", "labels", "teams", "repositories"] as const;
export type FilterSource = (typeof FILTER_SOURCES)[number];

export interface FilterField {
	key: string;
	label: string;
	/** Heading in the field picker. */
	group: string;
	kind: FilterKind;
	/**
	 * The events this field exists on. A condition on a field the event does
	 * not carry reads as "not set" rather than erroring, but the builder uses
	 * this to keep the picker honest about what is actually there.
	 */
	events: readonly WebhookEvent[];
	/** A closed set of values. Validation rejects anything outside it. */
	options?: readonly FilterOption[];
	/** An open set, resolved from the workspace. Validation stays permissive. */
	source?: FilterSource;
	/** Dotted path into `{ event, actor, ...data }`. */
	path: string;
	/** Narrows the raw payload value down to something comparable. */
	map?: (raw: unknown) => FilterValue;
}

/** Whether this field's values are picked from a list rather than typed. */
export function fieldHasOptions(field: FilterField | undefined): boolean {
	return field !== undefined && (field.options !== undefined || field.source !== undefined);
}

export type FilterValue = string | number | string[] | null;

const ISSUE_EVENTS_FULL = [
	"issue.created",
	"issue.updated",
	"issue.assigned",
	"issue.status_changed",
	"comment.created",
	"feedback.converted",
] as const satisfies readonly WebhookEvent[];

/** `issue.deleted` carries a summary — identifier, title and team, nothing more. */
const ISSUE_EVENTS_ANY = [...ISSUE_EVENTS_FULL, "issue.deleted"] as const;

const FEEDBACK_EVENTS_FULL = [
	"feedback.created",
	"feedback.updated",
	"feedback.assigned",
	"feedback.status_changed",
	"feedback.converted",
	"feedback.comment_created",
] as const satisfies readonly WebhookEvent[];

const FEEDBACK_EVENTS_ANY = [...FEEDBACK_EVENTS_FULL, "feedback.deleted"] as const;

/** The events that carry `data.changes`. */
const CHANGE_EVENTS = [
	"issue.updated",
	"issue.assigned",
	"issue.status_changed",
	"feedback.updated",
	"feedback.assigned",
	"feedback.status_changed",
] as const satisfies readonly WebhookEvent[];

const USER_TYPE_OPTIONS: readonly FilterOption[] = [
	{ value: "human", label: "Person" },
	{ value: "agent", label: "Agent" },
];

const BOOLEAN_OPTIONS: readonly FilterOption[] = [
	{ value: "true", label: "Yes" },
	{ value: "false", label: "No" },
];

/**
 * The keys `data.changes` actually uses, so "only when the priority changed" is
 * something you pick rather than something you have to know the spelling of.
 *
 * They are the writer's field names — `assigneeId`, not "assignee" — because
 * that is what lands in the payload. The labels are what a person would say.
 */
const CHANGED_FIELD_OPTIONS: readonly FilterOption[] = [
	{ value: "title", label: "Title" },
	{ value: "description", label: "Description" },
	{ value: "status", label: "Status" },
	{ value: "priority", label: "Priority" },
	{ value: "assigneeId", label: "Assignee" },
	{ value: "team", label: "Team" },
	{ value: "repositoryId", label: "Repository" },
	{ value: "labels", label: "Labels" },
	{ value: "visibility", label: "Visibility (feedback)" },
	{ value: "labelIds", label: "Labels (feedback)" },
];

/** Names out of a `Label[]`, so a condition compares against what people type. */
const labelNames = (raw: unknown): string[] =>
	Array.isArray(raw)
		? raw.flatMap((entry) =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as { name?: unknown }).name === "string"
					? [(entry as { name: string }).name]
					: [],
			)
		: [];

/** Which fields moved, out of the `{ field: { from, to } }` change map. */
const changedFields = (raw: unknown): string[] =>
	typeof raw === "object" && raw !== null ? Object.keys(raw) : [];

export const FILTER_FIELDS: readonly FilterField[] = [
	{
		key: "event",
		label: "Event",
		group: "Event",
		kind: "enum",
		events: WEBHOOK_EVENTS,
		options: WEBHOOK_EVENTS.map((event) => ({ value: event, label: WEBHOOK_EVENT_LABELS[event] })),
		path: "event",
	},
	{
		key: "changes.fields",
		label: "Changed field",
		group: "Event",
		kind: "list",
		events: CHANGE_EVENTS,
		options: CHANGED_FIELD_OPTIONS,
		path: "changes",
		map: changedFields,
	},

	{
		key: "actor.name",
		label: "Actor name",
		group: "Actor",
		kind: "text",
		events: WEBHOOK_EVENTS,
		source: "members",
		path: "actor.name",
	},
	{
		key: "actor.email",
		label: "Actor email",
		group: "Actor",
		kind: "text",
		events: WEBHOOK_EVENTS,
		path: "actor.email",
	},
	{
		key: "actor.type",
		label: "Actor is",
		group: "Actor",
		kind: "enum",
		events: WEBHOOK_EVENTS,
		options: USER_TYPE_OPTIONS,
		path: "actor.type",
	},

	{
		key: "issue.title",
		label: "Issue title",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_ANY,
		path: "issue.title",
	},
	{
		key: "issue.description",
		label: "Issue description",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_FULL,
		path: "issue.description",
	},
	{
		key: "issue.identifier",
		label: "Issue identifier",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_ANY,
		path: "issue.identifier",
	},
	{
		key: "issue.status",
		label: "Issue status",
		group: "Issue",
		kind: "enum",
		events: ISSUE_EVENTS_FULL,
		options: ISSUE_STATUSES.map((status) => ({
			value: status,
			label: STATUS_LABELS[status as IssueStatus],
		})),
		path: "issue.status",
	},
	{
		key: "issue.priority",
		label: "Issue priority",
		group: "Issue",
		kind: "enum",
		events: ISSUE_EVENTS_FULL,
		options: ISSUE_PRIORITIES.map((priority) => ({
			value: priority,
			label: PRIORITY_LABELS[priority as IssuePriority],
		})),
		path: "issue.priority",
	},
	{
		key: "issue.labels",
		label: "Issue label",
		group: "Issue",
		kind: "list",
		events: ISSUE_EVENTS_FULL,
		source: "labels",
		path: "issue.labels",
		map: labelNames,
	},
	{
		key: "issue.team.key",
		label: "Issue team",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_ANY,
		source: "teams",
		path: "issue.team.key",
	},
	{
		key: "issue.assignee.name",
		label: "Issue assignee",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_FULL,
		source: "members",
		path: "issue.assignee.name",
	},
	{
		key: "issue.assignee.email",
		label: "Issue assignee email",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_FULL,
		path: "issue.assignee.email",
	},
	{
		key: "issue.assignee.type",
		label: "Issue assignee is",
		group: "Issue",
		kind: "enum",
		events: ISSUE_EVENTS_FULL,
		options: USER_TYPE_OPTIONS,
		path: "issue.assignee.type",
	},
	{
		key: "issue.creator.name",
		label: "Issue creator",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_FULL,
		source: "members",
		path: "issue.creator.name",
	},
	{
		key: "issue.repository.fullName",
		label: "Issue repository",
		group: "Issue",
		kind: "text",
		events: ISSUE_EVENTS_FULL,
		source: "repositories",
		path: "issue.repository.fullName",
	},
	{
		key: "issue.number",
		label: "Issue number",
		group: "Issue",
		kind: "number",
		events: ISSUE_EVENTS_FULL,
		path: "issue.number",
	},

	{
		key: "comment.body",
		label: "Comment body",
		group: "Comment",
		kind: "text",
		events: ["comment.created", "feedback.comment_created"],
		path: "comment.body",
	},
	{
		key: "comment.internal",
		label: "Comment is internal",
		group: "Comment",
		kind: "enum",
		events: ["feedback.comment_created"],
		options: BOOLEAN_OPTIONS,
		path: "comment.internal",
	},
	{
		key: "comment.author.type",
		label: "Comment author is",
		group: "Comment",
		kind: "enum",
		events: ["comment.created", "feedback.comment_created"],
		options: USER_TYPE_OPTIONS,
		path: "comment.author.type",
	},

	{
		key: "feedback.title",
		label: "Feedback title",
		group: "Feedback",
		kind: "text",
		events: FEEDBACK_EVENTS_ANY,
		path: "feedback.title",
	},
	{
		key: "feedback.description",
		label: "Feedback description",
		group: "Feedback",
		kind: "text",
		events: FEEDBACK_EVENTS_FULL,
		path: "feedback.description",
	},
	{
		key: "feedback.status",
		label: "Feedback status",
		group: "Feedback",
		kind: "enum",
		events: FEEDBACK_EVENTS_FULL,
		options: FEEDBACK_STATUSES.map((status) => ({
			value: status,
			label: FEEDBACK_STATUS_LABELS[status],
		})),
		path: "feedback.status",
	},
	{
		key: "feedback.priority",
		label: "Feedback priority",
		group: "Feedback",
		kind: "enum",
		events: FEEDBACK_EVENTS_FULL,
		options: ISSUE_PRIORITIES.map((priority) => ({
			value: priority,
			label: PRIORITY_LABELS[priority as IssuePriority],
		})),
		path: "feedback.priority",
	},
	{
		key: "feedback.assignee.name",
		label: "Feedback assignee",
		group: "Feedback",
		kind: "text",
		events: FEEDBACK_EVENTS_FULL,
		source: "members",
		path: "feedback.assignee.name",
	},
	{
		key: "feedback.assignee.type",
		label: "Feedback assignee is",
		group: "Feedback",
		kind: "enum",
		events: FEEDBACK_EVENTS_FULL,
		options: USER_TYPE_OPTIONS,
		path: "feedback.assignee.type",
	},
	{
		key: "feedback.visibility",
		label: "Feedback visibility",
		group: "Feedback",
		kind: "enum",
		events: FEEDBACK_EVENTS_FULL,
		options: [
			{ value: "private", label: "Private" },
			{ value: "public", label: "Public" },
		],
		path: "feedback.visibility",
	},
	{
		key: "feedback.labels",
		label: "Feedback label",
		group: "Feedback",
		kind: "list",
		events: FEEDBACK_EVENTS_FULL,
		source: "labels",
		path: "feedback.labels",
		map: labelNames,
	},
	{
		key: "feedback.source",
		label: "Feedback source",
		group: "Feedback",
		kind: "text",
		events: FEEDBACK_EVENTS_FULL,
		path: "feedback.source",
	},
	{
		key: "feedback.submitter.email",
		label: "Feedback submitter email",
		group: "Feedback",
		kind: "text",
		events: FEEDBACK_EVENTS_FULL,
		path: "feedback.submitter.email",
	},
];

const FIELDS_BY_KEY = new Map(FILTER_FIELDS.map((field) => [field.key, field]));

export function filterField(key: string): FilterField | undefined {
	return FIELDS_BY_KEY.get(key);
}

/** The field-picker order: grouped, in catalogue order within each group. */
export const FILTER_FIELD_GROUPS: readonly string[] = [
	...new Set(FILTER_FIELDS.map((field) => field.group)),
];

/**
 * The fields worth offering for a given subscription. A webhook listening only
 * for feedback has no business being offered issue priorities.
 */
export function fieldsForEvents(events: readonly WebhookEvent[]): FilterField[] {
	if (events.length === 0) return [...FILTER_FIELDS];
	return FILTER_FIELDS.filter((field) => events.some((event) => field.events.includes(event)));
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
	equals: "is",
	not_equals: "is not",
	contains: "contains",
	not_contains: "does not contain",
	starts_with: "starts with",
	ends_with: "ends with",
	in: "is any of",
	not_in: "is none of",
	includes: "includes",
	not_includes: "does not include",
	includes_any: "includes any of",
	includes_all: "includes all of",
	greater_than: "is greater than",
	less_than: "is less than",
	is_set: "is set",
	is_not_set: "is not set",
};

const OPERATORS_BY_KIND: Record<FilterKind, readonly FilterOperator[]> = {
	text: [
		"equals",
		"not_equals",
		"contains",
		"not_contains",
		"starts_with",
		"ends_with",
		"in",
		"not_in",
		"is_set",
		"is_not_set",
	],
	enum: ["equals", "not_equals", "in", "not_in", "is_set", "is_not_set"],
	list: ["includes", "not_includes", "includes_any", "includes_all", "is_set", "is_not_set"],
	number: ["equals", "not_equals", "greater_than", "less_than", "is_set", "is_not_set"],
};

export function operatorsFor(kind: FilterKind): readonly FilterOperator[] {
	return OPERATORS_BY_KIND[kind];
}

/** How many operands an operator takes — none, one, or a list. */
export type OperandArity = "none" | "one" | "many";

const MANY: readonly FilterOperator[] = ["in", "not_in", "includes_any", "includes_all"];
const NONE: readonly FilterOperator[] = ["is_set", "is_not_set"];

export function arityOf(operator: FilterOperator): OperandArity {
	if (NONE.includes(operator)) return "none";
	if (MANY.includes(operator)) return "many";
	return "one";
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** What a rule is evaluated against: the delivery payload, minus its envelope. */
export interface FilterSubject {
	event: string;
	actor: unknown;
	data: Record<string, unknown>;
}

/** Walks a dotted path, stopping at the first thing that is not an object. */
function at(source: unknown, path: string): unknown {
	let current = source;
	for (const step of path.split(".")) {
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as Record<string, unknown>)[step];
	}
	return current;
}

/**
 * The value a field points at, or null when the event does not carry it.
 *
 * `data` is spread at the root so a rule reads as `issue.status` rather than
 * `data.issue.status` — the two reserved names, `event` and `actor`, are never
 * keys inside `data`.
 */
export function readField(subject: FilterSubject, key: string): FilterValue {
	const field = filterField(key);
	if (field === undefined) return null;

	const root: Record<string, unknown> = {
		...subject.data,
		event: subject.event,
		actor: subject.actor,
	};

	const raw = at(root, field.path);
	if (field.map !== undefined) return field.map(raw);

	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") return raw;
	if (typeof raw === "number") return raw;
	if (typeof raw === "boolean") return raw ? "true" : "false";
	if (Array.isArray(raw)) return raw.filter((entry) => typeof entry === "string");
	return null;
}

/** Comparison is case- and whitespace-insensitive; nobody types exact case. */
const fold = (value: string): string => value.trim().toLowerCase();

function operands(condition: FilterCondition): string[] {
	const { value } = condition;
	if (value === undefined) return [];
	if (Array.isArray(value)) return value.map(fold).filter((entry) => entry !== "");
	const folded = fold(value);
	return folded === "" ? [] : [folded];
}

/** Present and non-empty — an empty string or an empty list counts as unset. */
function isSet(value: FilterValue): boolean {
	if (value === null) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "string") return value.trim() !== "";
	return true;
}

export function evaluateCondition(condition: FilterCondition, subject: FilterSubject): boolean {
	const actual = readField(subject, condition.field);
	const wanted = operands(condition);

	switch (condition.operator) {
		case "is_set":
			return isSet(actual);
		case "is_not_set":
			return !isSet(actual);
		default:
			break;
	}

	// An operator that needs an operand and has none is not a filter yet. It
	// passes, so a half-built rule never silently swallows every event.
	if (wanted.length === 0) return true;

	if (Array.isArray(actual)) return evaluateList(condition.operator, actual.map(fold), wanted);

	if (typeof actual === "number") {
		const compared = evaluateNumber(condition.operator, actual, wanted);
		if (compared !== null) return compared;
	}

	const text = actual === null ? null : fold(String(actual));
	return evaluateText(condition.operator, text, wanted);
}

function evaluateList(operator: FilterOperator, actual: string[], wanted: string[]): boolean {
	switch (operator) {
		case "includes":
		case "includes_any":
		case "in":
		case "equals":
			return wanted.some((entry) => actual.includes(entry));
		case "includes_all":
			return wanted.every((entry) => actual.includes(entry));
		case "not_includes":
		case "not_in":
		case "not_equals":
			return !wanted.some((entry) => actual.includes(entry));
		case "contains":
			return actual.some((entry) => wanted.some((want) => entry.includes(want)));
		case "not_contains":
			return !actual.some((entry) => wanted.some((want) => entry.includes(want)));
		case "starts_with":
			return actual.some((entry) => wanted.some((want) => entry.startsWith(want)));
		case "ends_with":
			return actual.some((entry) => wanted.some((want) => entry.endsWith(want)));
		default:
			return false;
	}
}

/** Null when the operator is not numeric, so text comparison can take over. */
function evaluateNumber(
	operator: FilterOperator,
	actual: number,
	wanted: string[],
): boolean | null {
	if (operator !== "greater_than" && operator !== "less_than") return null;

	const numbers = wanted.map(Number).filter((entry) => Number.isFinite(entry));
	if (numbers.length === 0) return true;

	return operator === "greater_than"
		? numbers.some((entry) => actual > entry)
		: numbers.some((entry) => actual < entry);
}

function evaluateText(operator: FilterOperator, actual: string | null, wanted: string[]): boolean {
	// A missing value equals nothing, so the negative operators hold and the
	// positive ones do not. `not_equals` on an unassigned issue is true.
	if (actual === null) {
		return operator === "not_equals" || operator === "not_contains" || operator === "not_in";
	}

	switch (operator) {
		case "equals":
		case "in":
		case "includes":
		case "includes_any":
			return wanted.includes(actual);
		case "includes_all":
			return wanted.length === 1 && wanted[0] === actual;
		case "not_equals":
		case "not_in":
		case "not_includes":
			return !wanted.includes(actual);
		case "contains":
			return wanted.some((entry) => actual.includes(entry));
		case "not_contains":
			return !wanted.some((entry) => actual.includes(entry));
		case "starts_with":
			return wanted.some((entry) => actual.startsWith(entry));
		case "ends_with":
			return wanted.some((entry) => actual.endsWith(entry));
		case "greater_than":
		case "less_than": {
			const compared = evaluateNumber(operator, Number(actual), wanted);
			return compared ?? false;
		}
		default:
			return false;
	}
}

export function evaluateRule(rule: FilterRule, subject: FilterSubject): boolean {
	return rule.type === "group" ? evaluateGroup(rule, subject) : evaluateCondition(rule, subject);
}

/**
 * An empty group matches. A webhook whose builder is open but empty must keep
 * delivering — "no conditions" is not "no events".
 */
export function evaluateGroup(group: FilterGroup, subject: FilterSubject): boolean {
	if (group.rules.length === 0) return true;
	return group.match === "all"
		? group.rules.every((rule) => evaluateRule(rule, subject))
		: group.rules.some((rule) => evaluateRule(rule, subject));
}

/**
 * Whether an event should be delivered. A null filter passes everything, which
 * is what every webhook created before conditions existed has.
 */
export function matchesFilter(filter: WebhookFilter | null, subject: FilterSubject): boolean {
	if (filter === null) return true;
	return evaluateGroup(filter, subject);
}

// ---------------------------------------------------------------------------
// Describing and validating
// ---------------------------------------------------------------------------

function describeOperands(condition: FilterCondition): string {
	const { value } = condition;
	if (value === undefined) return "";
	const list = Array.isArray(value) ? value : [value];
	const cleaned = list.map((entry) => entry.trim()).filter((entry) => entry !== "");
	if (cleaned.length === 0) return "";

	const field = filterField(condition.field);
	const labelled = cleaned.map((entry) => {
		const option = field?.options?.find((candidate) => candidate.value === entry);
		return option?.label ?? entry;
	});

	if (labelled.length === 1) return labelled[0]!;
	return `${labelled.slice(0, -1).join(", ")} or ${labelled.at(-1)!}`;
}

export function describeCondition(condition: FilterCondition): string {
	const field = filterField(condition.field);
	const name = field?.label ?? condition.field;
	const operator = OPERATOR_LABELS[condition.operator];
	const operand = describeOperands(condition);
	return operand === "" ? `${name} ${operator}` : `${name} ${operator} ${operand}`;
}

/** A one-line summary, the same phrasing the builder shows above the rules. */
export function describeFilter(filter: WebhookFilter | null): string {
	if (filter === null || filter.rules.length === 0) return "";
	return describeGroup(filter, true);
}

function describeGroup(group: FilterGroup, top: boolean): string {
	const joiner = group.match === "all" ? " and " : " or ";
	const parts = group.rules.map((rule) =>
		rule.type === "group" ? describeGroup(rule, false) : describeCondition(rule),
	);
	if (parts.length === 0) return "";
	if (parts.length === 1) return parts[0]!;
	const joined = parts.join(joiner);
	return top ? joined : `(${joined})`;
}

export function countRules(group: FilterGroup): number {
	return group.rules.reduce(
		(total, rule) => total + 1 + (rule.type === "group" ? countRules(rule) : 0),
		0,
	);
}

export function filterDepth(group: FilterGroup): number {
	const nested = group.rules.filter((rule) => rule.type === "group") as FilterGroup[];
	if (nested.length === 0) return 1;
	return 1 + Math.max(...nested.map(filterDepth));
}

/**
 * Structural checks the schema cannot express: unknown fields, operators a
 * field's kind does not support, and the size limits. Returns a message, or
 * null when the tree is sound.
 */
export function validateFilter(group: FilterGroup): string | null {
	if (filterDepth(group) > MAX_FILTER_DEPTH) {
		return `conditions may only nest ${MAX_FILTER_DEPTH} levels deep`;
	}
	if (countRules(group) > MAX_FILTER_RULES) {
		return `a webhook may have at most ${MAX_FILTER_RULES} conditions`;
	}
	return validateRules(group);
}

function validateRules(group: FilterGroup): string | null {
	for (const rule of group.rules) {
		const problem = rule.type === "group" ? validateRules(rule) : validateCondition(rule);
		if (problem !== null) return problem;
	}
	return null;
}

function validateCondition(condition: FilterCondition): string | null {
	const field = filterField(condition.field);
	if (field === undefined) return `${condition.field} is not a field you can filter on`;

	if (!operatorsFor(field.kind).includes(condition.operator)) {
		return `${OPERATOR_LABELS[condition.operator]} does not apply to ${field.label}`;
	}

	const arity = arityOf(condition.operator);
	const list = condition.value === undefined ? [] : [condition.value].flat();

	if (arity === "none") return null;
	if (list.every((entry) => entry.trim() === "")) {
		return `${field.label} ${OPERATOR_LABELS[condition.operator]} needs a value`;
	}
	if (list.length > MAX_FILTER_VALUES) {
		return `at most ${MAX_FILTER_VALUES} values per condition`;
	}
	if (list.some((entry) => entry.length > MAX_FILTER_VALUE_LENGTH)) {
		return `a condition value may be at most ${MAX_FILTER_VALUE_LENGTH} characters`;
	}
	if (field.options !== undefined) {
		const allowed = new Set(field.options.map((option) => option.value));
		const unknown = list.find((entry) => !allowed.has(entry.trim()));
		if (unknown !== undefined) return `${unknown} is not a value ${field.label} can take`;
	}
	return null;
}

/** What the builder starts an empty webhook on. */
export function emptyFilter(): WebhookFilter {
	return { type: "group", match: "all", rules: [] };
}
