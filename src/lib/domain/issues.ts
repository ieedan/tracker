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

/**
 * Every new workspace starts with these. A team's key is the issue prefix, so
 * the first issue filed to Engineering is ENG-1 and to Product is PRD-1.
 */
export const DEFAULT_TEAMS = [
	{ key: "ENG", name: "Engineering" },
	{ key: "PRD", name: "Product" },
] as const;

/** Uppercase letters and digits, starting with a letter. 1–6 characters. */
export const TEAM_KEY_PATTERN = /^[A-Z][A-Z0-9]{0,5}$/;

/** `ENG-42` → `{ key: "ENG", number: 42 }`; anything else → null. */
export function parseIdentifier(value: string): { key: string; number: number } | null {
	const match = /^([A-Za-z][A-Za-z0-9]{0,5})-(\d+)$/.exec(value.trim());
	if (match === null) return null;

	const number = Number(match[2]);
	if (!Number.isSafeInteger(number) || number < 1) return null;

	return { key: match[1]!.toUpperCase(), number };
}

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
