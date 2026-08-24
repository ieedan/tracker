// Request and response schemas shared by the API handlers, the generated
// OpenAPI document, and the browser. Kit forbids a client file from importing
// an endpoint, so anything both sides need lives here.
import * as v from "valibot";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, NOTIFICATION_TYPES, WORKSPACE_ROLES } from "./issues";
import { DELIVERY_STATUSES, WEBHOOK_EVENTS } from "./webhooks";

export const IssueStatusSchema = v.picklist(ISSUE_STATUSES);
export const IssuePrioritySchema = v.picklist(ISSUE_PRIORITIES);
export const WorkspaceRoleSchema = v.picklist(WORKSPACE_ROLES);

export const UserSummary = v.object({
	id: v.string(),
	name: v.string(),
	email: v.string(),
	image: v.nullable(v.string()),
});
export type UserSummary = v.InferOutput<typeof UserSummary>;

export const LabelSchema = v.object({
	id: v.string(),
	name: v.string(),
	color: v.string(),
});
export type Label = v.InferOutput<typeof LabelSchema>;

export const WorkspaceSchema = v.object({
	id: v.string(),
	name: v.string(),
	slug: v.string(),
	role: WorkspaceRoleSchema,
	createdAt: v.string(),
});
export type Workspace = v.InferOutput<typeof WorkspaceSchema>;

/** A team owns issues, and its key is their prefix. */
export const TeamSchema = v.object({
	id: v.string(),
	name: v.string(),
	/** The `ENG` in `ENG-42`. */
	key: v.string(),
	issueCount: v.number(),
	createdAt: v.string(),
});
export type Team = v.InferOutput<typeof TeamSchema>;

/** The team as it appears on an issue — no counts, just identity. */
export const TeamRefSchema = v.object({
	id: v.string(),
	name: v.string(),
	key: v.string(),
});
export type TeamRef = v.InferOutput<typeof TeamRefSchema>;

export const IssueSchema = v.object({
	id: v.string(),
	number: v.number(),
	/** `ENG-42` — the owning team's key and the issue number. */
	identifier: v.string(),
	team: TeamRefSchema,
	title: v.string(),
	description: v.string(),
	status: IssueStatusSchema,
	priority: IssuePrioritySchema,
	assignee: v.nullable(UserSummary),
	creator: UserSummary,
	labels: v.array(LabelSchema),
	commentCount: v.number(),
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type Issue = v.InferOutput<typeof IssueSchema>;

export const CommentSchema = v.object({
	id: v.string(),
	body: v.string(),
	author: UserSummary,
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type Comment = v.InferOutput<typeof CommentSchema>;

export const MemberSchema = v.object({
	id: v.string(),
	role: WorkspaceRoleSchema,
	user: UserSummary,
	createdAt: v.string(),
});
export type Member = v.InferOutput<typeof MemberSchema>;

export const NotificationSchema = v.object({
	id: v.string(),
	type: v.picklist(NOTIFICATION_TYPES),
	body: v.string(),
	read: v.boolean(),
	actor: UserSummary,
	workspaceSlug: v.string(),
	issue: v.nullable(v.object({ identifier: v.string(), title: v.string(), number: v.number() })),
	createdAt: v.string(),
});
export type Notification = v.InferOutput<typeof NotificationSchema>;

export const WebhookEventSchema = v.picklist(WEBHOOK_EVENTS);

export const WebhookSchema = v.object({
	id: v.string(),
	url: v.string(),
	description: v.string(),
	events: v.array(WebhookEventSchema),
	enabled: v.boolean(),
	createdAt: v.string(),
	/** Rolling health, so a broken endpoint is visible without opening it. */
	lastDeliveryAt: v.nullable(v.string()),
	lastDeliveryStatus: v.nullable(v.picklist(DELIVERY_STATUSES)),
	failingSince: v.nullable(v.string()),
});
export type Webhook = v.InferOutput<typeof WebhookSchema>;

export const WebhookDeliverySchema = v.object({
	id: v.string(),
	event: WebhookEventSchema,
	status: v.picklist(DELIVERY_STATUSES),
	attempts: v.number(),
	responseStatus: v.nullable(v.number()),
	error: v.nullable(v.string()),
	nextAttemptAt: v.nullable(v.string()),
	deliveredAt: v.nullable(v.string()),
	createdAt: v.string(),
});
export type WebhookDelivery = v.InferOutput<typeof WebhookDeliverySchema>;

export const CreateWebhookBody = v.object({
	url: v.pipe(v.string(), v.trim(), v.url("must be an absolute http(s) URL")),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ""),
	/** At least one — a webhook subscribed to nothing would never fire. */
	events: v.pipe(v.array(WebhookEventSchema), v.minLength(1, "choose at least one event")),
});

export const UpdateWebhookBody = v.partial(
	v.object({
		description: v.pipe(v.string(), v.trim(), v.maxLength(200)),
		events: v.pipe(v.array(WebhookEventSchema), v.minLength(1, "choose at least one event")),
		enabled: v.boolean(),
	}),
);

export const ApiKeySchema = v.object({
	id: v.string(),
	name: v.nullable(v.string()),
	start: v.nullable(v.string()),
	prefix: v.nullable(v.string()),
	enabled: v.boolean(),
	createdAt: v.string(),
	lastRequest: v.nullable(v.string()),
});
export type ApiKey = v.InferOutput<typeof ApiKeySchema>;

// --- request bodies -------------------------------------------------------

const trimmed = (min: number, max: number) =>
	v.pipe(v.string(), v.trim(), v.minLength(min), v.maxLength(max));

export const CreateWorkspaceBody = v.object({
	name: trimmed(1, 60),
});

export const CreateTeamBody = v.object({
	name: trimmed(1, 60),
	/** Issue prefix. Uppercased server-side; defaults to initials of the name. */
	key: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(6))),
});

export const CreateIssueBody = v.object({
	/** Which team files it — decides the identifier prefix. */
	teamKey: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6)),
	title: trimmed(1, 200),
	description: v.optional(v.pipe(v.string(), v.maxLength(20_000)), ""),
	status: v.optional(IssueStatusSchema, "backlog"),
	priority: v.optional(IssuePrioritySchema, "none"),
	assigneeId: v.optional(v.nullable(v.string())),
	labelIds: v.optional(v.array(v.string())),
});

export const UpdateIssueBody = v.partial(
	v.object({
		/** Moving between teams reallocates the number, so the identifier changes. */
		teamKey: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6)),
		title: trimmed(1, 200),
		description: v.pipe(v.string(), v.maxLength(20_000)),
		status: IssueStatusSchema,
		priority: IssuePrioritySchema,
		assigneeId: v.nullable(v.string()),
		labelIds: v.array(v.string()),
	}),
);

export const CreateCommentBody = v.object({ body: trimmed(1, 10_000) });

export const AddMemberBody = v.object({
	email: v.pipe(v.string(), v.trim(), v.email()),
	role: v.optional(WorkspaceRoleSchema, "member"),
});

export const CreateInviteBody = v.object({
	role: v.optional(WorkspaceRoleSchema, "member"),
	/** Hours until the link stops working. Omit for a link that does not expire. */
	expiresInHours: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(24 * 90))),
});

export const CreateLabelBody = v.object({
	name: trimmed(1, 40),
	color: v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/)),
});

export const CreateApiKeyBody = v.object({ name: trimmed(1, 60) });

export const MarkNotificationsBody = v.object({
	/** Omit to mark every notification read. */
	ids: v.optional(v.array(v.string())),
});
