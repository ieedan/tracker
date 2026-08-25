// The issue timeline's vocabulary. Shared between the API handlers and the
// browser, so no server imports may ever appear in this file.

/**
 * Everything that can land on an issue's timeline besides a comment.
 *
 * `created` is never stored: the issue row already carries its creator and its
 * creation time, so the timeline synthesises that first entry rather than every
 * issue filed before this table existed needing a backfill.
 */
export const ACTIVITY_TYPES = [
	"created",
	"status_changed",
	"priority_changed",
	"assignee_changed",
	"title_changed",
	"description_changed",
	"labels_changed",
	"team_changed",
	"repository_changed",
	"pull_request_linked",
	"pull_request_unlinked",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
