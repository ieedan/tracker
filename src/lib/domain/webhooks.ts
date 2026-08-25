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

/** The header names a receiver reads. */
export const SIGNATURE_HEADER = "x-tracker-signature";
export const EVENT_HEADER = "x-tracker-event";
export const DELIVERY_HEADER = "x-tracker-delivery";
export const TIMESTAMP_HEADER = "x-tracker-timestamp";
