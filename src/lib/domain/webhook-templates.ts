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
 * escaped form exists to survive.
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
			identifier: "ENG-42",
			title: 'Fix the "remember me" redirect loop',
			status: "todo",
			priority: "high",
		},
	},
};
