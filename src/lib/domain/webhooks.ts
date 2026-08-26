// The event catalogue, shared by the API, the delivery pipeline and the UI.

export const WEBHOOK_EVENTS = [
	"issue.created",
	"issue.updated",
	"issue.assigned",
	"issue.status_changed",
	"issue.deleted",
	"comment.created",
	"feedback.created",
	"feedback.updated",
	"feedback.status_changed",
	"feedback.converted",
	"feedback.comment_created",
	"feedback.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** What a new webhook listens for until the creator changes it. */
export const DEFAULT_WEBHOOK_EVENTS: WebhookEvent[] = ["issue.created", "issue.updated"];

export const WEBHOOK_EVENT_GROUPS: { label: string; events: readonly WebhookEvent[] }[] = [
	{
		label: "Issues",
		events: [
			"issue.created",
			"issue.updated",
			"issue.assigned",
			"issue.status_changed",
			"issue.deleted",
			"comment.created",
		],
	},
	{
		label: "Feedback",
		events: [
			"feedback.created",
			"feedback.updated",
			"feedback.status_changed",
			"feedback.converted",
			"feedback.comment_created",
			"feedback.deleted",
		],
	},
];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
	"issue.created": "Issue created",
	"issue.updated": "Issue updated",
	"issue.assigned": "Issue assigned",
	"issue.status_changed": "Issue status changed",
	"issue.deleted": "Issue deleted",
	"comment.created": "Comment created",
	"feedback.created": "Feedback received",
	"feedback.updated": "Feedback updated",
	"feedback.status_changed": "Feedback status changed",
	"feedback.converted": "Feedback converted to issue",
	"feedback.comment_created": "Feedback reply posted",
	"feedback.deleted": "Feedback deleted",
};

export const WEBHOOK_EVENT_HINTS: Record<WebhookEvent, string> = {
	"issue.created": "A new issue is filed to any team.",
	"issue.updated": "Any field changes — title, description, priority, labels, team.",
	"issue.assigned": "The assignee changes, including being cleared.",
	"issue.status_changed": "The status moves, e.g. Todo → In Progress.",
	"issue.deleted": "An issue is removed.",
	"comment.created": "Someone comments on an issue.",
	"feedback.created": "New feedback arrives at the ingest endpoint.",
	"feedback.updated": "Feedback is edited — title, description, labels, visibility.",
	"feedback.status_changed": "Triage moves it, e.g. New → Planned.",
	"feedback.converted": "Feedback becomes an issue. Carries both.",
	"feedback.comment_created": "Someone replies to feedback, publicly or internally.",
	"feedback.deleted": "Feedback is removed.",
};

/**
 * The shape of the request body.
 *
 * `json` is the canonical event object. `text` wraps that same object as
 * `{"text": "<summary + JSON>"}` — the shape freeform-text receivers take,
 * such as a Claude Code routine's API trigger or a Slack incoming webhook,
 * so an agent picking the event up gets the issue it is about without the
 * receiver having to parse a custom payload.
 */
export const WEBHOOK_FORMATS = ["json", "text"] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const DEFAULT_WEBHOOK_FORMAT: WebhookFormat = "json";

export const WEBHOOK_FORMAT_LABELS: Record<WebhookFormat, string> = {
	json: "JSON event",
	text: "Agent text",
};

export const WEBHOOK_FORMAT_HINTS: Record<WebhookFormat, string> = {
	json: "The event as a JSON object. For receivers written against this API.",
	text: 'The event wrapped as {"text": …} — a summary line, then the JSON. For Claude Code routine triggers, Slack, and other freeform-text receivers.',
};

export const DELIVERY_STATUSES = ["pending", "succeeded", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * How many times a delivery is attempted before it is given up on, and how long
 * to wait between attempts. Roughly a minute, then five, then half an hour —
 * long enough to ride out a deploy on the receiving end.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;
export const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;

/** Anything slower than this is treated as a failure and retried. */
export const DELIVERY_TIMEOUT_MS = 8_000;

/**
 * How much of an endpoint's response body is kept per delivery. Enough to read
 * an error message; not enough to let a chatty endpoint bloat the log table.
 */
export const MAX_STORED_RESPONSE_BODY = 2_000;

/** The header names a receiver reads. */
export const SIGNATURE_HEADER = "x-tracker-signature";
export const EVENT_HEADER = "x-tracker-event";
export const DELIVERY_HEADER = "x-tracker-delivery";
export const TIMESTAMP_HEADER = "x-tracker-timestamp";

// ---------------------------------------------------------------------------
// Custom headers
// ---------------------------------------------------------------------------

/**
 * Extra headers sent with every delivery — a bearer token for a gateway, a
 * tenant id, whatever the receiver authenticates on. Stored per webhook and
 * merged in *before* the pipeline's own headers, which always win: nothing set
 * here can spoof `x-tracker-signature` or lie about the content type.
 */
export const MAX_CUSTOM_HEADERS = 20;
export const MAX_HEADER_NAME_LENGTH = 100;
export const MAX_HEADER_VALUE_LENGTH = 1000;

/**
 * Names a webhook may not set.
 *
 * The transport ones would corrupt the request; the `x-tracker-*` ones are the
 * receiver's proof of who sent this, and a header the workspace controls must
 * never be mistakable for one the pipeline signed.
 */
export const RESERVED_HEADERS: readonly string[] = [
	"host",
	"content-length",
	"content-type",
	"connection",
	"transfer-encoding",
	"keep-alive",
	"upgrade",
	"te",
	"trailer",
	"expect",
	"http2-settings",
	SIGNATURE_HEADER,
	EVENT_HEADER,
	DELIVERY_HEADER,
	TIMESTAMP_HEADER,
];

/** RFC 9110 token characters — anything else cannot be a header name. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Printable ASCII, tab, and the high range `fetch` still accepts.
 *
 * Control characters are rejected rather than stripped: a CR or LF in a value
 * is request splitting, and silently repairing it hides that someone tried.
 */
const HEADER_VALUE_PATTERN = /^[\t\x20-\x7e\x80-\xff]*$/;

/** A message naming what is wrong with a header, or null when it is fine. */
export function validateHeader(name: string, value: string): string | null {
	const trimmed = name.trim();
	if (trimmed === "") return "a header needs a name";
	if (trimmed.length > MAX_HEADER_NAME_LENGTH) {
		return `header names may be at most ${MAX_HEADER_NAME_LENGTH} characters`;
	}
	if (!HEADER_NAME_PATTERN.test(trimmed)) {
		return `"${trimmed}" is not a valid header name`;
	}
	if (RESERVED_HEADERS.includes(trimmed.toLowerCase())) {
		return `${trimmed} is set by the delivery pipeline and cannot be overridden`;
	}
	if (value.length > MAX_HEADER_VALUE_LENGTH) {
		return `${trimmed} is longer than ${MAX_HEADER_VALUE_LENGTH} characters`;
	}
	if (!HEADER_VALUE_PATTERN.test(value)) {
		return `${trimmed} contains a character that cannot go in a header`;
	}
	return null;
}

/** The same checks over a whole map, plus the count limit. */
export function validateHeaders(headers: Record<string, string>): string | null {
	const names = Object.keys(headers);
	if (names.length > MAX_CUSTOM_HEADERS) {
		return `a webhook may set at most ${MAX_CUSTOM_HEADERS} custom headers`;
	}

	const seen = new Set<string>();
	for (const name of names) {
		const problem = validateHeader(name, headers[name] ?? "");
		if (problem !== null) return problem;

		const lower = name.trim().toLowerCase();
		if (seen.has(lower)) return `${name.trim()} is set twice`;
		seen.add(lower);
	}
	return null;
}

/** Trims the names and drops the unnamed rows a half-filled editor leaves. */
export function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		const trimmed = name.trim();
		if (trimmed === "") continue;
		result[trimmed] = value;
	}
	return result;
}
