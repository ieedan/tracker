// Rendering for the non-JSON webhook formats: the "text" wrapper's summary
// body, and the "custom" format's user-authored template.
//
// Pure and DOM-free on purpose — the delivery pipeline renders the real event
// server-side, and the settings dialog renders a live preview client-side, so
// both must share one implementation or the preview lies.

/** The canonical delivery body, which is also what templates resolve against. */
export interface TemplateEvent {
	id: string;
	event: string;
	createdAt: string;
	workspace: { id: string; slug: string; name: string };
	actor: {
		id: string;
		name: string;
		email: string;
		type?: "human" | "agent";
		onBehalfOf?: { id: string; name: string } | null;
	} | null;
	data: Record<string, unknown>;
}

/**
 * One line saying what the event is about —
 * `tracker issue.created in Acme: ENG-42 — Fix login redirect (by Ada)`.
 * Exposed to templates as `{{summary}}`.
 */
export function summarize(event: TemplateEvent): string {
	const subject = subjectOf(event.data);
	const by = event.actor === null ? "" : ` (by ${event.actor.name})`;
	return (
		`tracker ${event.event} in ${event.workspace.name}` +
		(subject === null ? "" : `: ${subject}`) +
		by
	);
}

/** `ENG-42 — Fix login redirect`, from whichever entity the event carries. */
function subjectOf(data: Record<string, unknown>): string | null {
	for (const key of ["issue", "feedback"]) {
		const entity = data[key];
		if (entity === null || typeof entity !== "object") continue;
		const { identifier, title } = entity as { identifier?: unknown; title?: unknown };
		if (typeof identifier === "string" && typeof title === "string") {
			return `${identifier} — ${title}`;
		}
	}
	return null;
}

/**
 * The `text` format's body. A freeform-text receiver — a Claude Code routine's
 * API trigger, which caps `text` at 65,536 characters — hands this to an agent
 * verbatim, so: the summary line first, then the canonical JSON for the rest.
 */
const MAX_TEXT_LENGTH = 60_000;

export function renderText(event: TemplateEvent): string {
	const headline = summarize(event);

	const text = `${headline}\n\nFull event payload (JSON):\n${JSON.stringify(event, null, 2)}`;
	if (text.length <= MAX_TEXT_LENGTH) return text;

	const compact = `${headline}\n\nFull event payload (JSON):\n${JSON.stringify(event)}`;
	if (compact.length <= MAX_TEXT_LENGTH) return compact;
	return `${compact.slice(0, MAX_TEXT_LENGTH)}\n… (truncated)`;
}

// ---------------------------------------------------------------------------
// Custom templates
// ---------------------------------------------------------------------------

export const MAX_TEMPLATE_LENGTH = 10_000;

/**
 * `{{path}}` for use inside JSON strings, `{{{path}}}` for raw values.
 *
 * Both forms take a dot path into the event (`data.issue.title`), plus the
 * synthesized `summary`. The two-brace form inserts the value escaped as JSON
 * string *content*, so a quote in an issue title cannot break out of the
 * string it sits in; the three-brace form inserts the value as a JSON value
 * (quotes and all), which is what embedding a whole object needs. The raw
 * form must match first or `{{{x}}}` would parse as `{` + `{{x}}`.
 */
const PLACEHOLDER = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;

export function renderTemplate(template: string, event: TemplateEvent): string {
	return template.replace(
		PLACEHOLDER,
		(_, raw: string | undefined, escaped: string | undefined) => {
			if (raw !== undefined) {
				const value = resolve(event, raw);
				// `null` rather than nothing: a missing raw value must still leave
				// valid JSON behind, exactly as it does with the sample event.
				return value === undefined ? "null" : JSON.stringify(value);
			}

			const value = resolve(event, escaped ?? "");
			if (value === undefined || value === null) return "";
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return JSON.stringify(text).slice(1, -1);
		},
	);
}

function resolve(event: TemplateEvent, path: string): unknown {
	if (path === "summary") return summarize(event);
	let current: unknown = event;
	for (const segment of path.split(".")) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/**
 * A message naming what is wrong with a template, or null when it is fine.
 *
 * Validity is checked by rendering the sample event and parsing the result.
 * That check is structural, so it transfers to real events: the escaped form
 * can only produce string content, and the raw form always yields a complete
 * JSON value — the data cannot make a sample-valid template render invalid.
 */
export function validateTemplate(template: string): string | null {
	if (template.trim() === "") return "a custom format needs a template body";
	if (template.length > MAX_TEMPLATE_LENGTH) {
		return `a template may be at most ${MAX_TEMPLATE_LENGTH} characters`;
	}
	try {
		JSON.parse(renderTemplate(template, SAMPLE_EVENT));
	} catch {
		return 'the template does not render to valid JSON — put {{…}} inside quotes ("…{{data.issue.title}}…"), or use {{{…}}} to insert a raw value';
	}
	return null;
}

/**
 * What the settings dialog previews against, and what `validateTemplate`
 * renders. The quotes in the title are deliberate: they are exactly what the
 * escaped form exists to survive. The issue is the full serialized shape, so
 * the editor's suggestions and preview show what a real delivery carries.
 */
export const SAMPLE_EVENT: TemplateEvent = {
	id: "dlv_sample0000000000000",
	event: "issue.created",
	createdAt: "2026-01-01T12:00:00.000Z",
	workspace: { id: "ws_sample", slug: "acme", name: "Acme" },
	actor: {
		id: "usr_sample",
		name: "Ada Lovelace",
		email: "ada@example.com",
		type: "human",
		onBehalfOf: null,
	},
	data: {
		issue: {
			id: "iss_sample",
			number: 42,
			identifier: "ENG-42",
			team: { id: "team_sample", name: "Engineering", key: "ENG" },
			title: 'Fix the "remember me" redirect loop',
			description: "Signing in with remember me checked redirects back to /login.",
			status: "todo",
			priority: "high",
			assignee: null,
			creator: {
				id: "usr_sample",
				name: "Ada Lovelace",
				email: "ada@example.com",
				image: null,
				type: "human",
			},
			labels: [{ id: "lbl_sample", name: "Bug", color: "#ef4444" }],
			commentCount: 0,
			repository: null,
			pullRequest: null,
			feedback: null,
			attachments: [],
			createdAt: "2026-01-01T12:00:00.000Z",
			updatedAt: "2026-01-01T12:00:00.000Z",
		},
	},
};

// ---------------------------------------------------------------------------
// Editor support: suggestions and highlighting
// ---------------------------------------------------------------------------

export interface TemplateSuggestion {
	path: string;
	/** What sits there — a sample value, or which events carry it. */
	hint: string;
}

/**
 * Hand-written hints where the sample value alone would mislead — fields that
 * are null until something sets them, and fields the sample event lacks
 * because they belong to other event kinds.
 */
const HINT_OVERRIDES: Record<string, string> = {
	summary: "one line: what happened, to what, by whom",
	actor: "who did it; null for system events",
	"actor.onBehalfOf": "the human an agent acted for; null otherwise",
	data: "the event's entities — differs per event kind",
	"data.issue.assignee": "null until assigned; a user object after",
	"data.issue.repository": "null unless scoped to a repository",
	"data.issue.pullRequest": "null until a PR is linked",
	"data.issue.feedback": "null unless converted from feedback",
	"data.issue.attachments": "files on the issue",
	"data.issue.labels": "the issue's labels",
};

/** Fields the sample `issue.created` event cannot show. */
const EXTRA_SUGGESTIONS: TemplateSuggestion[] = [
	{ path: "data.changes", hint: "what moved, on *.updated and *.status_changed" },
	{ path: "data.comment", hint: "the reply, on comment events" },
	{ path: "data.comment.body", hint: "comment events" },
	{ path: "data.comment.id", hint: "comment events" },
	{ path: "data.comment.createdAt", hint: "comment events" },
	{ path: "data.feedback", hint: "the feedback, on feedback.* events" },
	{ path: "data.feedback.identifier", hint: '"FB-12" — feedback.* events' },
	{ path: "data.feedback.title", hint: "feedback.* events" },
	{ path: "data.feedback.number", hint: "feedback.* events" },
	{ path: "data.feedback.status", hint: "feedback.* events" },
	{ path: "data.feedback.description", hint: "feedback.* events" },
];

function hintFor(value: unknown): string {
	if (value === null) return "null in the sample";
	if (typeof value === "string") {
		const quoted = JSON.stringify(value);
		return quoted.length <= 42 ? quoted : `${quoted.slice(0, 41)}…"`;
	}
	if (Array.isArray(value)) return "array — {{{…}}} inserts it as JSON";
	if (typeof value === "object") return "object — {{{…}}} inserts it as JSON";
	return String(value);
}

function flatten(value: unknown, path: string, into: TemplateSuggestion[]): void {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		into.push({ path, hint: HINT_OVERRIDES[path] ?? hintFor(value) });
		for (const [key, child] of Object.entries(value)) flatten(child, `${path}.${key}`, into);
		return;
	}
	into.push({ path, hint: HINT_OVERRIDES[path] ?? hintFor(value) });
}

/** Everything the editor offers, `summary` first, in event order. */
export const TEMPLATE_SUGGESTIONS: TemplateSuggestion[] = (() => {
	const suggestions: TemplateSuggestion[] = [
		{ path: "summary", hint: HINT_OVERRIDES.summary ?? "" },
	];
	for (const [key, value] of Object.entries(SAMPLE_EVENT)) flatten(value, key, suggestions);
	suggestions.push(...EXTRA_SUGGESTIONS);
	return suggestions;
})();

const KNOWN_PATHS = new Set(TEMPLATE_SUGGESTIONS.map((entry) => entry.path));

/**
 * Whether a path names something deliveries can carry. Paths under objects
 * whose shape varies (`data.changes.title.from`) and array indexing into the
 * sample (`data.issue.labels.0.name`) count as known; anything else is likely
 * a typo, which is what the editor's highlighting flags.
 */
export function isKnownPath(path: string): boolean {
	if (KNOWN_PATHS.has(path)) return true;
	if (resolve(SAMPLE_EVENT, path) !== undefined) return true;
	return ["data.changes.", "data.comment.", "data.feedback."].some((prefix) =>
		path.startsWith(prefix),
	);
}

/** The suggestions matching a partly-typed path, for the completion menu. */
export function suggestTemplatePaths(token: string, limit = 8): TemplateSuggestion[] {
	const query = token.toLowerCase();
	return TEMPLATE_SUGGESTIONS.filter((entry) => entry.path.toLowerCase().startsWith(query)).slice(
		0,
		limit,
	);
}

export interface TemplateSegment {
	text: string;
	kind: "text" | "known" | "unknown";
}

/**
 * The template cut into runs for the editor's highlight layer: plain text,
 * placeholders whose path the events carry, and placeholders that look like
 * typos. Concatenating the segments always reproduces the template exactly —
 * the layer renders *instead of* the textarea's own text, so a dropped
 * character would corrupt what the person sees.
 */
export function segmentTemplate(template: string): TemplateSegment[] {
	const segments: TemplateSegment[] = [];
	let last = 0;
	for (const match of template.matchAll(PLACEHOLDER)) {
		if (match.index > last)
			segments.push({ text: template.slice(last, match.index), kind: "text" });
		const path = match[1] ?? match[2] ?? "";
		segments.push({ text: match[0], kind: isKnownPath(path) ? "known" : "unknown" });
		last = match.index + match[0].length;
	}
	if (last < template.length) segments.push({ text: template.slice(last), kind: "text" });
	return segments;
}
