// Shared between the ingest endpoint, the workspace tab and the public board.
// No server imports — the public pages render this in the browser too.

/**
 * Who may POST to a workspace's `user-feedback` endpoint.
 *
 * The default is `api_key`, not `public`: an open ingest endpoint on a URL that
 * only needs a workspace slug is something you should have to turn on, not
 * something you discover after it has been filled with spam.
 */
export const FEEDBACK_INTAKE_MODES = ["disabled", "api_key", "public"] as const;
export type FeedbackIntake = (typeof FEEDBACK_INTAKE_MODES)[number];

export const FEEDBACK_INTAKE_LABELS: Record<FeedbackIntake, string> = {
	disabled: "Closed",
	api_key: "API key required",
	public: "Open to anyone",
};

export const FEEDBACK_INTAKE_HINTS: Record<FeedbackIntake, string> = {
	disabled: "The endpoint returns 404. Nothing can be submitted.",
	api_key: "Callers must present a workspace API key. Best for a backend proxying your app.",
	public: "Anyone with the URL can submit, rate limited by IP. Best for an in-app widget.",
};

/** Whether the public board at `/<slug>/public/feedback` is readable by anyone. */
export const FEEDBACK_BOARD_MODES = ["private", "public"] as const;
export type FeedbackBoard = (typeof FEEDBACK_BOARD_MODES)[number];

/**
 * Per-item, and never wider than the workspace's board setting.
 *
 * Even with a public board an individual piece of feedback can be held back —
 * people put order numbers and phone numbers in feedback forms.
 */
export const FEEDBACK_VISIBILITIES = ["private", "public"] as const;
export type FeedbackVisibility = (typeof FEEDBACK_VISIBILITIES)[number];

/**
 * How feedback is triaged. Deliberately *not* the issue statuses: feedback is
 * not work, it is a request for work, and "In Progress" on a request is a
 * category error. Converting is what turns one into the other.
 */
export const FEEDBACK_STATUSES = ["new", "reviewing", "planned", "accepted", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
	new: "New",
	reviewing: "Reviewing",
	planned: "Planned",
	accepted: "Accepted",
	declined: "Declined",
};

export const FEEDBACK_STATUS_ORDER: Record<FeedbackStatus, number> = {
	new: 0,
	reviewing: 1,
	planned: 2,
	accepted: 3,
	declined: 4,
};

/** Tailwind classes per status, so a board scans at a glance. */
export const FEEDBACK_STATUS_COLORS: Record<FeedbackStatus, string> = {
	new: "text-sky-500",
	reviewing: "text-amber-500",
	planned: "text-violet-500",
	accepted: "text-emerald-500",
	declined: "text-muted-foreground",
};

/**
 * Applied to every issue converted from feedback, created on demand.
 *
 * The point is that six months later you can filter the backlog by it and see
 * which of your work came from someone actually asking for it.
 */
export const FEEDBACK_LABEL_NAME = "user feedback";
export const FEEDBACK_LABEL_COLOR = "#00a2c7";

/** `FB-12` — the public reference for a piece of feedback. */
export const FEEDBACK_PREFIX = "FB";

export function feedbackIdentifier(number: number): string {
	return `${FEEDBACK_PREFIX}-${number}`;
}

/**
 * Ingest limits. Public intake is per-IP and stingy; a key is a credential the
 * workspace issued, so it gets room to batch a day of widget submissions.
 */
export const FEEDBACK_RATE_LIMITS = {
	public: { limit: 5, windowMs: 60_000 },
	api_key: { limit: 120, windowMs: 60_000 },
	/** Public replies, per signed-in account. Enough to hold a conversation. */
	comment: { limit: 10, windowMs: 60_000 },
} as const;
