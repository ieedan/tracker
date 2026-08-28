// Shared between the ingest endpoint, the workspace tab and the public board.
// No server imports — the public pages render this in the browser too.
import type { IssueStatus } from "./issues";

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
 * How feedback is triaged, and then how the work on it is getting on.
 *
 * The first three are the triage a person does — it arrived, someone read it,
 * someone agreed to it. The last three are not decisions anybody makes here:
 * once feedback has been converted its status is *derived* from the issue it
 * became, by `feedbackStatusForIssue` below, and cannot be set by hand (ENG-77).
 *
 * That split is the whole point. A request and the work it turned into are one
 * thing to the person who asked for it, so a board that says Accepted while the
 * issue behind it shipped three weeks ago is lying to them — and a status
 * anybody can click back to New is a board that drifts by Tuesday.
 */
export const FEEDBACK_STATUSES = [
	"new",
	"reviewing",
	"accepted",
	"planned",
	"in_progress",
	"done",
	"declined",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * The statuses a person may set directly — everything before an issue exists,
 * plus the two ways triage ends without one.
 *
 * `accepted` is here because converting is what sets it, and because feedback
 * whose issue was later deleted falls back to it.
 */
export const FEEDBACK_TRIAGE_STATUSES = [
	"new",
	"reviewing",
	"accepted",
	"declined",
] as const satisfies readonly FeedbackStatus[];
export type FeedbackTriageStatus = (typeof FEEDBACK_TRIAGE_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
	new: "New",
	reviewing: "Reviewing",
	accepted: "Accepted",
	planned: "Planned",
	in_progress: "In Progress",
	done: "Done",
	declined: "Declined",
};

export const FEEDBACK_STATUS_ORDER: Record<FeedbackStatus, number> = {
	new: 0,
	reviewing: 1,
	accepted: 2,
	planned: 3,
	in_progress: 4,
	done: 5,
	declined: 6,
};

/** Tailwind classes per status, so a board scans at a glance. */
export const FEEDBACK_STATUS_COLORS: Record<FeedbackStatus, string> = {
	new: "text-sky-500",
	reviewing: "text-amber-500",
	// Agreed and scheduled are the same phase at two degrees of commitment, so
	// they share a hue and are told apart by their glyph.
	accepted: "text-violet-500",
	planned: "text-violet-500",
	in_progress: "text-orange-500",
	done: "text-emerald-500",
	declined: "text-muted-foreground",
};

/**
 * What the issue's status means for the request that became it.
 *
 * Written from the submitter's side of the glass, not the team's: they do not
 * care whether something is in review or in rework, only that somebody is on
 * it. So the three working statuses collapse into one, and the two that mean
 * "not through this issue" collapse into Declined.
 *
 * `duplicate` is the lossy one. The work may well ship under whatever this was
 * a duplicate of, but that is a different issue and this feedback is not linked
 * to it, so there is nothing truthful left to derive from — Declined is the
 * honest answer for *this* record rather than a promise it cannot keep.
 */
export function feedbackStatusForIssue(status: IssueStatus): FeedbackStatus {
	switch (status) {
		case "backlog":
			return "accepted";
		case "todo":
			return "planned";
		case "rework":
		case "in_progress":
		case "in_review":
			return "in_progress";
		case "done":
			return "done";
		case "canceled":
		case "duplicate":
			return "declined";
	}
}

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
