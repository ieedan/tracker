// Shared between the API handlers and the browser. No server imports may ever
// appear in this file — kit enforces that for `*.server.ts`, and a schema that
// both an endpoint and a form need has to live somewhere both can reach.

export const ISSUE_STATUSES = ["backlog", "todo", "in_progress", "done", "canceled"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["none", "urgent", "high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const STATUS_LABELS: Record<IssueStatus, string> = {
	backlog: "Backlog",
	todo: "Todo",
	in_progress: "In Progress",
	done: "Done",
	canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
	none: "No priority",
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
};

/** The order Linear shows statuses in — backlog first, terminal states last. */
export const STATUS_ORDER: Record<IssueStatus, number> = {
	backlog: 0,
	todo: 1,
	in_progress: 2,
	done: 3,
	canceled: 4,
};

/** Urgent sorts above high, and "none" sinks to the bottom. */
export const PRIORITY_ORDER: Record<IssuePriority, number> = {
	urgent: 0,
	high: 1,
	medium: 2,
	low: 3,
	none: 4,
};

export const NOTIFICATION_TYPES = [
	"issue_assigned",
	"issue_unassigned",
	"issue_status_changed",
	"issue_commented",
	"workspace_invited",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const WORKSPACE_ROLES = ["admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Linear-ish label palette. */
export const LABEL_COLORS = [
	"#e5484d",
	"#f76b15",
	"#f5d90a",
	"#46a758",
	"#00a2c7",
	"#3e63dd",
	"#8e4ec6",
	"#d6409f",
	"#8b8d98",
] as const;
