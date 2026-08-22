/**
 * The shapes the API returns and the UI renders. Deliberately independent of
 * the drizzle row types: this file is imported by client code, and the schema
 * is server-only.
 */

export type UserDto = {
	id: string;
	name: string;
	image: string | null;
	githubLogin: string | null;
};

export type StatusCategory = "backlog" | "unstarted" | "started" | "completed" | "canceled";

export type StatusDto = {
	id: string;
	name: string;
	category: StatusCategory;
	color: string;
	position: number;
};

export type LabelDto = {
	id: string;
	name: string;
	color: string;
	description: string | null;
};

export type RepoDto = {
	id: string;
	name: string;
	description: string | null;
	isPrivate: boolean;
};

export type WorkspaceDto = {
	id: string;
	slug: string;
	name: string;
	avatarUrl: string | null;
	type: "User" | "Organization";
	prefix: string;
};

export type IssueDto = {
	id: string;
	identifier: string;
	number: number;
	/** Raw markdown, as typed. */
	title: string;
	/** `title` rendered to an inline-only HTML subset. Already sanitized. */
	titleHtml: string;
	/** Raw markdown, as typed. */
	description: string;
	/** `description` rendered to sanitized HTML. */
	descriptionHtml: string;
	status: StatusDto;
	priority: Priority;
	assignee: UserDto | null;
	creator: UserDto | null;
	repo: RepoDto | null;
	labels: LabelDto[];
	position: string;
	commentCount: number;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
	canceledAt: string | null;
};

export type CommentDto = {
	id: string;
	body: string;
	bodyHtml: string;
	author: UserDto | null;
	createdAt: string;
	updatedAt: string;
};

export type AttachmentDto = {
	id: string;
	filename: string;
	contentType: string;
	size: number;
	/** Absolute, publicly readable, and unguessable. */
	url: string;
	createdAt: string;
};

export type WebhookDto = {
	id: string;
	url: string;
	events: string[];
	enabled: boolean;
	lastStatus: number | null;
	lastError: string | null;
	lastDeliveredAt: string | null;
	createdAt: string;
	/** Only ever present on the create response — it is not stored in readable form again. */
	secret?: string;
};

export type ApiKeyDto = {
	id: string;
	name: string | null;
	start: string | null;
	createdAt: string;
	expiresAt: string | null;
	lastRequest: string | null;
	/** Only present on create. */
	key?: string;
};

/** Linear's priority scale, in Linear's sort order. */
export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
	0: "No priority",
	1: "Urgent",
	2: "High",
	3: "Medium",
	4: "Low",
};

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
	backlog: "Backlog",
	unstarted: "Todo",
	started: "In Progress",
	completed: "Done",
	canceled: "Canceled",
};

/** Every event an outbound webhook can subscribe to. */
export const WEBHOOK_EVENTS = [
	"issue.created",
	"issue.updated",
	"issue.deleted",
	"comment.created",
	"comment.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** What the SSE stream pushes. Mirrors the webhook events, plus the payload. */
export type RealtimeEvent =
	| { type: "issue.created"; issue: IssueDto }
	| { type: "issue.updated"; issue: IssueDto }
	| { type: "issue.deleted"; issueId: string }
	| { type: "comment.created"; issueId: string; comment: CommentDto }
	| { type: "comment.deleted"; issueId: string; commentId: string };

export type Paginated<T> = {
	items: T[];
	/** Pass back as `cursor` to fetch the next page. Null when the list is exhausted. */
	nextCursor: string | null;
};
