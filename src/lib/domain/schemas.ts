// Request and response schemas shared by the API handlers, the generated
// OpenAPI document, and the browser. Kit forbids a client file from importing
// an endpoint, so anything both sides need lives here.
import * as v from "valibot";
import { ACTIVITY_TYPES } from "./activity";
import { AGENT_HARNESSES, USER_TYPES } from "./agents";
import { API_KEY_ACTIONS } from "./api-keys";
import { FEEDBACK_BOARD_MODES, FEEDBACK_INTAKE_MODES, FEEDBACK_STATUSES } from "./feedback";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, NOTIFICATION_TYPES, WORKSPACE_ROLES } from "./issues";
import { GIT_PROVIDERS, INDEX_STATES, PULL_REQUEST_STATES } from "./providers";
import {
	FILTER_MATCHES,
	FILTER_OPERATORS,
	validateFilter,
	type FilterGroup,
	type FilterRule,
} from "./webhook-filters";
import { DELIVERY_STATUSES, normalizeHeaders, validateHeaders, WEBHOOK_EVENTS } from "./webhooks";

export const GitProviderSchema = v.picklist(GIT_PROVIDERS);
export const IssueStatusSchema = v.picklist(ISSUE_STATUSES);
export const IssuePrioritySchema = v.picklist(ISSUE_PRIORITIES);
export const WorkspaceRoleSchema = v.picklist(WORKSPACE_ROLES);

export const UserSummary = v.object({
	id: v.string(),
	name: v.string(),
	email: v.string(),
	image: v.nullable(v.string()),
	/**
	 * "agent" marks a bot member. Carried on every user the API returns so the
	 * UI can badge a comment or an assignee without a second lookup.
	 */
	type: v.picklist(USER_TYPES),
	/** Which coding agent a bot is, so its mark renders anywhere it appears. */
	harness: v.nullable(v.picklist(AGENT_HARNESSES)),
});
export type UserSummary = v.InferOutput<typeof UserSummary>;

export const LabelSchema = v.object({
	id: v.string(),
	name: v.string(),
	color: v.string(),
});
export type Label = v.InferOutput<typeof LabelSchema>;

export const FeedbackIntakeSchema = v.picklist(FEEDBACK_INTAKE_MODES);
export const FeedbackBoardSchema = v.picklist(FEEDBACK_BOARD_MODES);
export const FeedbackStatusSchema = v.picklist(FEEDBACK_STATUSES);

export const WorkspaceSchema = v.object({
	id: v.string(),
	name: v.string(),
	slug: v.string(),
	role: WorkspaceRoleSchema,
	/** App URL for the workspace picture, or null. Redirects to storage. */
	image: v.nullable(v.string()),
	/** Who may POST feedback to this workspace. */
	feedbackIntake: FeedbackIntakeSchema,
	/** Whether the public feedback board is readable without signing in. */
	feedbackBoard: FeedbackBoardSchema,
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

export const AttachmentSchema = v.object({
	id: v.string(),
	filename: v.string(),
	contentType: v.string(),
	size: v.number(),
	/** Points at this app, which redirects to a short-lived storage URL. */
	url: v.string(),
	uploadedBy: UserSummary,
	createdAt: v.string(),
});
export type Attachment = v.InferOutput<typeof AttachmentSchema>;

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
	/** The repository this issue is scoped to, when it is scoped to one. */
	repository: v.nullable(
		v.object({ id: v.string(), fullName: v.string(), provider: GitProviderSchema }),
	),
	/** The pull request solving it — at most one, and at most one issue per PR. */
	pullRequest: v.nullable(
		v.object({
			id: v.string(),
			number: v.number(),
			title: v.string(),
			state: v.picklist(PULL_REQUEST_STATES),
			url: v.string(),
		}),
	),
	/** Set when this issue was converted from a piece of user feedback. */
	feedback: v.nullable(
		v.object({ id: v.string(), number: v.number(), identifier: v.string(), title: v.string() }),
	),
	/**
	 * Files hanging off the issue itself.
	 *
	 * Attachments left on a comment belong to that comment and come back with
	 * it instead — this is only what was attached to the issue.
	 */
	attachments: v.array(AttachmentSchema),
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type Issue = v.InferOutput<typeof IssueSchema>;

export const CreateAttachmentBody = v.object({
	filename: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
	contentType: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
	size: v.pipe(v.number(), v.integer(), v.minValue(1)),
	/** Attach to an issue, or to a comment. Neither means a draft upload. */
	issueId: v.optional(v.string()),
	commentId: v.optional(v.string()),
});

export const CommentSchema = v.object({
	id: v.string(),
	body: v.string(),
	author: UserSummary,
	attachments: v.array(AttachmentSchema),
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type Comment = v.InferOutput<typeof CommentSchema>;

export const ActivityTypeSchema = v.picklist(ACTIVITY_TYPES);

/**
 * One entry on an issue's timeline.
 *
 * `from`/`to` are snapshots taken when the change happened rather than live
 * references: a status is its raw value (`in_progress`), everything else is the
 * text it read as at the time, so renaming a repository later does not rewrite
 * history.
 */
export const ActivitySchema = v.object({
	id: v.string(),
	type: ActivityTypeSchema,
	actor: UserSummary,
	from: v.nullable(v.string()),
	to: v.nullable(v.string()),
	/** Only on `labels_changed`: which labels moved, and which way. */
	labels: v.array(v.object({ name: v.string(), color: v.string(), added: v.boolean() })),
	createdAt: v.string(),
});
export type Activity = v.InferOutput<typeof ActivitySchema>;

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

/**
 * One rule in a webhook's condition tree — either a comparison or a nested
 * group of them. Recursive, so `v.lazy` is what expresses it.
 */
export const FilterConditionSchema = v.object({
	type: v.literal("condition"),
	field: v.pipe(v.string(), v.trim(), v.minLength(1)),
	operator: v.picklist(FILTER_OPERATORS),
	value: v.optional(v.union([v.string(), v.array(v.string())])),
});

export const FilterRuleSchema: v.GenericSchema<FilterRule> = v.lazy(() =>
	v.union([FilterConditionSchema, FilterGroupSchema]),
);

export const FilterGroupSchema: v.GenericSchema<FilterGroup> = v.object({
	type: v.literal("group"),
	match: v.picklist(FILTER_MATCHES),
	rules: v.array(FilterRuleSchema),
});

/**
 * The whole tree, checked structurally as well as shape-wise: `validateFilter`
 * is what rejects an unknown field, an operator the field's kind cannot take,
 * and a tree that is too deep or too large.
 */
export const WebhookFilterSchema = v.pipe(
	FilterGroupSchema,
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const problem = validateFilter(dataset.value);
		if (problem !== null) addIssue({ message: problem });
	}),
);

/** A header map, validated against the reserved names and the size limits. */
export const WebhookHeadersSchema = v.pipe(
	v.record(v.string(), v.string()),
	v.transform(normalizeHeaders),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const problem = validateHeaders(dataset.value);
		if (problem !== null) addIssue({ message: problem });
	}),
);

export const WebhookSchema = v.object({
	id: v.string(),
	url: v.string(),
	description: v.string(),
	events: v.array(WebhookEventSchema),
	/** Extra headers sent with every delivery. Never the reserved ones. */
	headers: v.record(v.string(), v.string()),
	/** The condition tree, or null when the webhook takes every event. */
	filter: v.nullable(FilterGroupSchema),
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
	headers: v.optional(WebhookHeadersSchema, {}),
	/** Null, or omitted, means every event the subscription covers. */
	filter: v.optional(v.nullable(WebhookFilterSchema), null),
});

export const UpdateWebhookBody = v.partial(
	v.object({
		description: v.pipe(v.string(), v.trim(), v.maxLength(200)),
		events: v.pipe(v.array(WebhookEventSchema), v.minLength(1, "choose at least one event")),
		headers: WebhookHeadersSchema,
		/** Explicit null clears the conditions. */
		filter: v.nullable(WebhookFilterSchema),
		enabled: v.boolean(),
	}),
);

export const ApiKeyActionSchema = v.picklist(API_KEY_ACTIONS);

export const ApiKeyPermissionsSchema = v.partial(
	v.object({
		issues: v.array(ApiKeyActionSchema),
		workspace: v.array(ApiKeyActionSchema),
		labels: v.array(ApiKeyActionSchema),
		members: v.array(ApiKeyActionSchema),
		webhooks: v.array(ApiKeyActionSchema),
		feedback: v.array(ApiKeyActionSchema),
		notifications: v.array(ApiKeyActionSchema),
	}),
);

// --- repositories ---------------------------------------------------------

/** How complete the `@`-mention index is, and why not, when it is not. */
export const RepositoryIndexSchema = v.object({
	state: v.picklist(INDEX_STATES),
	/** The ref the index was built from. */
	ref: v.string(),
	fileCount: v.number(),
	/** True when the provider capped the tree — the index is real but partial. */
	truncated: v.boolean(),
	indexedAt: v.nullable(v.string()),
	error: v.string(),
});

export const RepositorySchema = v.object({
	id: v.string(),
	provider: GitProviderSchema,
	owner: v.string(),
	name: v.string(),
	/** `owner/name`, which is how people say it. */
	fullName: v.string(),
	defaultBranch: v.string(),
	private: v.boolean(),
	url: v.string(),
	description: v.string(),
	index: RepositoryIndexSchema,
	createdAt: v.string(),
});
export type Repository = v.InferOutput<typeof RepositorySchema>;

/** A repository the installation can see but the workspace has not linked. */
export const AvailableRepositorySchema = v.object({
	externalId: v.string(),
	owner: v.string(),
	name: v.string(),
	fullName: v.string(),
	private: v.boolean(),
	description: v.string(),
	/** True when it is already linked, so the picker can say so rather than fail. */
	linked: v.boolean(),
});

export const PullRequestSchema = v.object({
	id: v.string(),
	number: v.number(),
	title: v.string(),
	state: v.picklist(PULL_REQUEST_STATES),
	url: v.string(),
	authorLogin: v.string(),
	repository: v.object({ id: v.string(), fullName: v.string() }),
	syncedAt: v.nullable(v.string()),
	createdAt: v.string(),
});
export type PullRequest = v.InferOutput<typeof PullRequestSchema>;

/** One entry in the `@` file picker. */
export const RepositoryFileSchema = v.object({
	repositoryId: v.string(),
	fullName: v.string(),
	path: v.string(),
	url: v.string(),
});

export const LinkRepositoryBody = v.object({
	/** From the available list. */
	externalId: v.optional(v.string()),
	/** Or name it directly, for a repository the picker did not show. */
	owner: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100))),
	name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
});

export const LinkPullRequestBody = v.object({
	/** A URL, `owner/name#12`, or `#12` when the issue already has a repository. */
	reference: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(400)),
});

export const ApiKeySchema = v.object({
	id: v.string(),
	name: v.nullable(v.string()),
	start: v.nullable(v.string()),
	prefix: v.nullable(v.string()),
	enabled: v.boolean(),
	createdAt: v.string(),
	lastRequest: v.nullable(v.string()),
	expiresAt: v.nullable(v.string()),
	/**
	 * `null` on keys minted before scopes existed — they can do anything the
	 * owner can. An empty object is the opposite: explicitly no access.
	 */
	permissions: v.nullable(ApiKeyPermissionsSchema),
});
export type ApiKey = v.InferOutput<typeof ApiKeySchema>;

// --- request bodies -------------------------------------------------------

const trimmed = (min: number, max: number) =>
	v.pipe(v.string(), v.trim(), v.minLength(min), v.maxLength(max));

export const CreateWorkspaceBody = v.object({
	name: trimmed(1, 60),
	/** A key from `POST /api/v1/uploads/image`, uploaded before this existed. */
	imageKey: v.optional(v.string()),
});

export const CreateTeamBody = v.object({
	name: trimmed(1, 60),
	/** Issue prefix. Uppercased server-side; defaults to initials of the name. */
	key: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(6))),
});

export const CreateIssueBody = v.object({
	/** Scope the issue to one of the workspace's linked repositories. */
	repositoryId: v.optional(v.nullable(v.string())),
	/** Which team files it — decides the identifier prefix. */
	teamKey: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6)),
	title: trimmed(1, 200),
	description: v.optional(v.pipe(v.string(), v.maxLength(20_000)), ""),
	status: v.optional(IssueStatusSchema, "backlog"),
	priority: v.optional(IssuePrioritySchema, "none"),
	assigneeId: v.optional(v.nullable(v.string())),
	labelIds: v.optional(v.array(v.string())),
	/** Draft uploads to hang off the new issue. */
	attachmentIds: v.optional(v.array(v.string())),
});

export const UpdateIssueBody = v.partial(
	v.object({
		repositoryId: v.nullable(v.string()),
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

/** Move an issue into another workspace. Numbers reallocate, so the identifier changes. */
export const TransferIssueBody = v.object({
	workspaceSlug: trimmed(1, 60),
	teamKey: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6)),
});

export const CreateCommentBody = v.object({
	body: trimmed(1, 10_000),
	/** Uploads made while drafting, adopted by the comment on submit. */
	attachmentIds: v.optional(v.array(v.string())),
});

export const AddMemberBody = v.object({
	email: v.pipe(v.string(), v.trim(), v.email()),
	role: v.optional(WorkspaceRoleSchema, "member"),
});

export const UpdateMemberBody = v.object({
	role: WorkspaceRoleSchema,
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

// --- user feedback --------------------------------------------------------

/** Who sent it. Every field is optional; anonymous public posts have none. */
export const FeedbackSubmitterSchema = v.object({
	name: v.nullable(v.string()),
	/** Members only — a submitter's address is never shown on the public board. */
	email: v.nullable(v.string()),
	user: v.nullable(UserSummary),
});

export const FeedbackSchema = v.object({
	id: v.string(),
	number: v.number(),
	/** `FB-12`. */
	identifier: v.string(),
	title: v.string(),
	description: v.string(),
	status: FeedbackStatusSchema,
	visibility: v.picklist(["private", "public"]),
	labels: v.array(LabelSchema),
	submitter: FeedbackSubmitterSchema,
	source: v.nullable(v.string()),
	commentCount: v.number(),
	subscriberCount: v.number(),
	/** The issue this became, once someone converted it. */
	issue: v.nullable(v.object({ id: v.string(), identifier: v.string(), title: v.string() })),
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type Feedback = v.InferOutput<typeof FeedbackSchema>;

export const FeedbackCommentSchema = v.object({
	id: v.string(),
	body: v.string(),
	author: UserSummary,
	/** Workspace-only note. Never present in a public response. */
	internal: v.boolean(),
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type FeedbackComment = v.InferOutput<typeof FeedbackCommentSchema>;

/**
 * The ingest body. Kept small on purpose — this is the one endpoint someone
 * else's code calls, and every required field is a reason for it not to.
 */
export const CreateFeedbackBody = v.object({
	title: trimmed(1, 200),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20_000)), ""),
	/** Who is asking, for a reply. Also the address `subscribe` uses. */
	email: v.optional(v.pipe(v.string(), v.trim(), v.email("must be an email address"))),
	name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(80))),
	/** Where it came from: `widget`, `ios`, `support-inbox`. */
	source: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
	/** Show it on the public board. Ignored when the board is private. */
	public: v.optional(v.boolean(), false),
	/** Add `email` to the list notified when this feedback moves. */
	subscribe: v.optional(v.boolean(), false),
});

export const UpdateFeedbackBody = v.partial(
	v.object({
		title: trimmed(1, 200),
		description: v.pipe(v.string(), v.maxLength(20_000)),
		status: FeedbackStatusSchema,
		visibility: v.picklist(["private", "public"]),
		labelIds: v.array(v.string()),
	}),
);

export const ConvertFeedbackBody = v.object({
	/** Which team files the issue. Defaults to the workspace's first team. */
	teamKey: v.optional(v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6))),
	/** Defaults to the feedback's own title and description. */
	title: v.optional(trimmed(1, 200)),
	priority: v.optional(IssuePrioritySchema, "none"),
	assigneeId: v.optional(v.nullable(v.string())),
	/** The feedback status to leave behind. Defaults to `accepted`. */
	status: v.optional(FeedbackStatusSchema, "accepted"),
});

export const CreateFeedbackCommentBody = v.object({
	body: trimmed(1, 10_000),
	/** Members only. A non-member asking for this is refused, not downgraded. */
	internal: v.optional(v.boolean(), false),
});

export const SubscribeFeedbackBody = v.object({
	email: v.pipe(v.string(), v.trim(), v.email("must be an email address")),
});

export const UpdateWorkspaceBody = v.partial(
	v.object({
		name: trimmed(1, 60),
		/** A key from `POST /api/v1/uploads/image`. Null clears the picture. */
		imageKey: v.nullable(v.string()),
		feedbackIntake: FeedbackIntakeSchema,
		feedbackBoard: FeedbackBoardSchema,
	}),
);

export const CreateApiKeyBody = v.object({
	name: trimmed(1, 60),
	permissions: v.pipe(
		ApiKeyPermissionsSchema,
		v.check(
			(value) => Object.values(value).some((actions) => (actions?.length ?? 0) > 0),
			"choose at least one permission",
		),
	),
	/** Seconds until the key expires. Omit for a key that does not expire. */
	expiresIn: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(60 * 60 * 24), v.maxValue(60 * 60 * 24 * 365)),
	),
});

/** How the inbox is ordered. Newest first is the default. */
export const NOTIFICATION_ORDERS = ["newest", "oldest"] as const;
export const NotificationOrderSchema = v.picklist(NOTIFICATION_ORDERS);
export type NotificationOrder = v.InferOutput<typeof NotificationOrderSchema>;

export const MarkNotificationsBody = v.object({
	/** Omit to mark every notification. */
	ids: v.optional(v.array(v.string())),
	/** `false` puts them back in the unread state. Defaults to marking read. */
	read: v.optional(v.boolean()),
});

/** One agent install you have connected. */
export const ConnectedAgentSchema = v.object({
	grantId: v.string(),
	clientId: v.string(),
	name: v.string(),
	harness: v.picklist(AGENT_HARNESSES),
	scopes: v.array(v.string()),
	lastUsedAt: v.nullable(v.string()),
	createdAt: v.string(),
});
export type ConnectedAgent = v.InferOutput<typeof ConnectedAgentSchema>;

/** An agent that can act in a workspace, and the members it acts for. */
export const WorkspaceAgentSchema = v.object({
	harness: v.picklist(AGENT_HARNESSES),
	name: v.string(),
	connectedBy: v.array(v.object({ id: v.string(), name: v.string() })),
});
export type WorkspaceAgent = v.InferOutput<typeof WorkspaceAgentSchema>;

/** What the consent screen posts once someone answers an authorization request. */
export const OAuthConsentBody = v.object({
	/** The provider's signed authorization query, handed back verbatim. */
	oauthQuery: v.pipe(v.string(), v.minLength(1)),
	accept: v.boolean(),
	/** Which workspace the agent is being let into. Ignored when denying. */
	slug: v.optional(v.pipe(v.string(), v.trim()), ""),
	scopes: v.optional(v.array(v.string()), []),
	/**
	 * What this agent is, as the person authorizing it says — never read off
	 * the client's own registration, which anyone can write.
	 */
	harness: v.optional(v.picklist(AGENT_HARNESSES), "other"),
	/** Overrides the harness's catalog name. Blank means "use the catalog name". */
	name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
});

export const UpdateAgentBody = v.partial(
	v.object({
		name: v.pipe(v.string(), v.trim(), v.maxLength(60)),
		harness: v.picklist(AGENT_HARNESSES),
	}),
);

// --- issue templates ------------------------------------------------------

/**
 * A saved starting point for a new issue, owned by the workspace.
 *
 * Every prefill is resolved server-side, so the composer can apply a template
 * without a second round of lookups — the team, assignee and labels arrive as
 * the same shapes an issue carries them in.
 */
export const IssueTemplateSchema = v.object({
	id: v.string(),
	/** What the template is called in the New issue menu. */
	name: v.string(),
	/** One line under the name in settings. Never lands on the issue. */
	summary: v.string(),
	/** The prefilled issue title. Blank means "start empty". */
	title: v.string(),
	description: v.string(),
	/** Null when the template does not pin a team, or its team was deleted. */
	team: v.nullable(TeamRefSchema),
	status: IssueStatusSchema,
	priority: IssuePrioritySchema,
	assignee: v.nullable(UserSummary),
	labels: v.array(LabelSchema),
	createdAt: v.string(),
	updatedAt: v.string(),
});
export type IssueTemplate = v.InferOutput<typeof IssueTemplateSchema>;

export const CreateIssueTemplateBody = v.object({
	name: trimmed(1, 60),
	summary: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ""),
	title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ""),
	description: v.optional(v.pipe(v.string(), v.maxLength(20_000)), ""),
	/** Omit or null to let the composer pick the team as it normally would. */
	teamKey: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6))),
		null,
	),
	status: v.optional(IssueStatusSchema, "backlog"),
	priority: v.optional(IssuePrioritySchema, "none"),
	assigneeId: v.optional(v.nullable(v.string()), null),
	labelIds: v.optional(v.array(v.string()), []),
});

export const UpdateIssueTemplateBody = v.partial(
	v.object({
		name: trimmed(1, 60),
		summary: v.pipe(v.string(), v.trim(), v.maxLength(200)),
		title: v.pipe(v.string(), v.trim(), v.maxLength(200)),
		description: v.pipe(v.string(), v.maxLength(20_000)),
		teamKey: v.nullable(v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6))),
		status: IssueStatusSchema,
		priority: IssuePrioritySchema,
		assigneeId: v.nullable(v.string()),
		labelIds: v.array(v.string()),
	}),
);
