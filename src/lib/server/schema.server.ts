import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ActivityType } from "@/lib/domain/activity";
import type {
	FeedbackBoard,
	FeedbackIntake,
	FeedbackStatus,
	FeedbackVisibility,
} from "@/lib/domain/feedback";
import type {
	IssuePriority,
	IssueStatus,
	NotificationType,
	WorkspaceRole,
} from "@/lib/domain/issues";
import type { GitProviderId, IndexState, PullRequestState } from "@/lib/domain/providers";
import type { HarnessKind } from "@/lib/domain/agents";
import type { WebhookFilter } from "@/lib/domain/webhook-filters";
import type { DeliveryStatus, WebhookEvent, WebhookFormat } from "@/lib/domain/webhooks";
import { user } from "./auth-schema.server";

export * from "./auth-schema.server";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = () =>
	timestamp("createdAt")
		.notNull()
		.default(sql`(unixepoch() * 1000)`);

export const workspace = sqliteTable("workspace", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	/**
	 * Object key for the workspace picture, or null for the letter tile.
	 *
	 * The key rather than a URL: a URL to private storage expires, and one to
	 * public storage would make the bucket public.
	 */
	image: text("image"),
	/** Who may POST to `/api/v1/workspaces/<slug>/user-feedback`. */
	feedbackIntake: text("feedbackIntake").$type<FeedbackIntake>().notNull().default("api_key"),
	/** Whether `/<slug>/public/feedback` is readable without signing in. */
	feedbackBoard: text("feedbackBoard").$type<FeedbackBoard>().notNull().default("private"),
	createdAt: now(),
	updatedAt: timestamp("updatedAt")
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

export const workspaceMember = sqliteTable(
	"workspace_member",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").$type<WorkspaceRole>().notNull().default("member"),
		createdAt: now(),
	},
	(table) => [
		uniqueIndex("workspace_member_unique").on(table.workspaceId, table.userId),
		index("workspace_member_user").on(table.userId),
	],
);

export const workspaceInvite = sqliteTable(
	"workspace_invite",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		token: text("token").notNull().unique(),
		role: text("role").$type<WorkspaceRole>().notNull().default("member"),
		createdBy: text("createdBy")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expiresAt"),
		revokedAt: timestamp("revokedAt"),
		createdAt: now(),
	},
	(table) => [index("workspace_invite_workspace").on(table.workspaceId)],
);

/**
 * Teams own issues, and a team's `key` is the issue prefix — the `ENG` in
 * `ENG-42`. A workspace is the container; every issue belongs to exactly one
 * team inside it.
 */
export const team = sqliteTable(
	"team",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** Uppercase, unique within the workspace. */
		key: text("key").notNull(),
		createdAt: now(),
	},
	(table) => [
		uniqueIndex("team_key_unique").on(table.workspaceId, table.key),
		index("team_workspace").on(table.workspaceId),
	],
);

export const label = sqliteTable(
	"label",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull(),
		createdAt: now(),
	},
	(table) => [uniqueIndex("label_unique").on(table.workspaceId, table.name)],
);

/**
 * A piece of user feedback.
 *
 * Same shape as an issue in the ways that matter — title, description, labels,
 * a number you can quote — but a separate table, because feedback is a request
 * for work rather than the work itself. Its statuses reflect triage, not
 * progress, and converting is what turns one into the other.
 */
export const feedback = sqliteTable(
	"feedback",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		/** Per-workspace counter — the `12` in `FB-12`. */
		number: integer("number").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status").$type<FeedbackStatus>().notNull().default("new"),
		visibility: text("visibility").$type<FeedbackVisibility>().notNull().default("private"),
		/**
		 * Who sent it. All three are optional and independent: an anonymous public
		 * post has none, a widget post has a name and email, a post from someone
		 * signed in has a user id as well.
		 */
		submitterName: text("submitterName"),
		submitterEmail: text("submitterEmail"),
		submitterUserId: text("submitterUserId").references(() => user.id, { onDelete: "set null" }),
		/** Free-form provenance from the caller: `widget`, `ios`, `support-inbox`. */
		source: text("source"),
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		uniqueIndex("feedback_number_unique").on(table.workspaceId, table.number),
		index("feedback_workspace_status").on(table.workspaceId, table.status),
		// The public board's query: this workspace, public only, newest first.
		index("feedback_public").on(table.workspaceId, table.visibility, table.createdAt),
	],
);

export const feedbackLabel = sqliteTable(
	"feedback_label",
	{
		feedbackId: text("feedbackId")
			.notNull()
			.references(() => feedback.id, { onDelete: "cascade" }),
		labelId: text("labelId")
			.notNull()
			.references(() => label.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.feedbackId, table.labelId] })],
);

/**
 * A reply on a piece of feedback.
 *
 * Always authored by a real account — that is the anti-spam measure the public
 * board relies on, since anyone can read it but only someone signed in can add
 * to it. `internal` keeps a team's own triage notes off the public board.
 */
export const feedbackComment = sqliteTable(
	"feedback_comment",
	{
		id: text("id").primaryKey(),
		feedbackId: text("feedbackId")
			.notNull()
			.references(() => feedback.id, { onDelete: "cascade" }),
		authorId: text("authorId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		body: text("body").notNull(),
		/** Visible to workspace members only. Never rendered on the public board. */
		internal: integer("internal", { mode: "boolean" }).notNull().default(false),
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index("feedback_comment_feedback").on(table.feedbackId, table.createdAt)],
);

/**
 * Someone who asked to hear when this feedback moves.
 *
 * Nothing sends mail yet; these are collected so that when it does, the list is
 * already there. The unique index is what makes a repeat subscribe a no-op
 * rather than a way to receive the same mail eleven times.
 */
export const feedbackSubscriber = sqliteTable(
	"feedback_subscriber",
	{
		id: text("id").primaryKey(),
		feedbackId: text("feedbackId")
			.notNull()
			.references(() => feedback.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		/** Set when the subscriber was signed in at the time. */
		userId: text("userId").references(() => user.id, { onDelete: "set null" }),
		createdAt: now(),
	},
	(table) => [uniqueIndex("feedback_subscriber_unique").on(table.feedbackId, table.email)],
);

/**
 * A fixed-window counter, keyed by whatever the caller decides identifies the
 * client — an IP for public intake, an API key id otherwise.
 *
 * It lives in the database rather than in memory because there is no shared
 * memory to put it in: every serverless invocation starts cold, so an in-process
 * counter would reset roughly as often as it was consulted.
 */
export const rateLimit = sqliteTable(
	"rate_limit",
	{
		key: text("key").primaryKey(),
		count: integer("count").notNull().default(0),
		/** When the window rolls over and `count` starts again at one. */
		resetAt: timestamp("resetAt").notNull(),
	},
	(table) => [index("rate_limit_reset").on(table.resetAt)],
);

/**
 * A grant of access to repositories — a GitHub App installation.
 *
 * Separate from `repository` because one installation covers many, and because
 * revoking it should take every repository with it. The token is deliberately
 * absent: an installation token lives an hour, so it is minted on demand rather
 * than stored where it would mostly be stale.
 */
export const providerInstallation = sqliteTable(
	"provider_installation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		provider: text("provider").$type<GitProviderId>().notNull(),
		/** The provider's id for the grant — GitHub's installation id. */
		externalId: text("externalId").notNull(),
		/** The org or user the App was installed on, for showing who granted what. */
		account: text("account").notNull().default(""),
		createdBy: text("createdBy")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: now(),
	},
	(table) => [
		uniqueIndex("installation_unique").on(table.workspaceId, table.provider, table.externalId),
		index("installation_workspace").on(table.workspaceId),
	],
);

/**
 * A repository linked to a workspace. Any number per workspace.
 *
 * `owner`/`name` are stored alongside `externalId` because every API path needs
 * them, but the external id is what identity means here — a rename changes the
 * first two and not the third.
 */
export const repository = sqliteTable(
	"repository",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		installationId: text("installationId")
			.notNull()
			.references(() => providerInstallation.id, { onDelete: "cascade" }),
		provider: text("provider").$type<GitProviderId>().notNull(),
		externalId: text("externalId").notNull(),
		owner: text("owner").notNull(),
		name: text("name").notNull(),
		defaultBranch: text("defaultBranch").notNull().default("main"),
		private: integer("private", { mode: "boolean" }).notNull().default(true),
		url: text("url").notNull(),
		description: text("description").notNull().default(""),

		// --- file index ------------------------------------------------------
		indexState: text("indexState").$type<IndexState>().notNull().default("never"),
		/** The ref the current index was built from. */
		indexRef: text("indexRef").notNull().default(""),
		indexedFileCount: integer("indexedFileCount").notNull().default(0),
		/** True when the provider capped the tree and the index is partial. */
		indexTruncated: integer("indexTruncated", { mode: "boolean" }).notNull().default(false),
		indexedAt: timestamp("indexedAt"),
		indexError: text("indexError").notNull().default(""),

		createdAt: now(),
	},
	(table) => [
		uniqueIndex("repository_unique").on(table.workspaceId, table.provider, table.externalId),
		index("repository_workspace").on(table.workspaceId),
	],
);

/**
 * One row per file path, so `@` has something to autocomplete against.
 *
 * Paths only. Contents would make this a clone, and every use — a link, a
 * mention, a scope — needs only the path.
 */
export const repositoryFile = sqliteTable(
	"repository_file",
	{
		id: text("id").primaryKey(),
		repositoryId: text("repositoryId")
			.notNull()
			.references(() => repository.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		/** Basename, stored so a search for `schema.ts` does not scan every path. */
		name: text("name").notNull(),
	},
	(table) => [
		uniqueIndex("repository_file_unique").on(table.repositoryId, table.path),
		index("repository_file_name").on(table.repositoryId, table.name),
	],
);

export const issue = sqliteTable(
	"issue",
	{
		id: text("id").primaryKey(),
		teamId: text("teamId")
			.notNull()
			.references(() => team.id, { onDelete: "cascade" }),
		/** Per-team counter — the `42` in `ENG-42`. */
		number: integer("number").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status").$type<IssueStatus>().notNull().default("backlog"),
		priority: text("priority").$type<IssuePriority>().notNull().default("none"),
		assigneeId: text("assigneeId").references(() => user.id, { onDelete: "set null" }),
		creatorId: text("creatorId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/**
		 * The feedback this issue was converted from, if any.
		 *
		 * Unique, so converting the same feedback twice cannot fan out into a pile
		 * of duplicate issues — the second attempt finds the first.
		 */
		feedbackId: text("feedbackId").references(() => feedback.id, { onDelete: "set null" }),
		/**
		 * Which repository this issue is about, when it is about one.
		 *
		 * `set null` rather than cascade: unlinking a repository should not delete
		 * the work that referenced it.
		 */
		repositoryId: text("repositoryId").references(() => repository.id, { onDelete: "set null" }),
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		uniqueIndex("issue_number_unique").on(table.teamId, table.number),
		index("issue_team").on(table.teamId),
		index("issue_assignee").on(table.assigneeId),
		index("issue_repository").on(table.repositoryId),
		uniqueIndex("issue_feedback_unique").on(table.feedbackId),
	],
);

/**
 * The pull request an issue is being solved by — at most one, each way.
 *
 * Both columns are unique, which is what makes the relationship 1:1 rather than
 * a convention everyone has to remember. State is kept as a snapshot rather than
 * fetched on render, so an issue list does not become a burst of API calls.
 */
export const pullRequest = sqliteTable(
	"pull_request",
	{
		id: text("id").primaryKey(),
		issueId: text("issueId")
			.notNull()
			.references(() => issue.id, { onDelete: "cascade" }),
		repositoryId: text("repositoryId")
			.notNull()
			.references(() => repository.id, { onDelete: "cascade" }),
		externalId: text("externalId").notNull(),
		number: integer("number").notNull(),
		title: text("title").notNull(),
		state: text("state").$type<PullRequestState>().notNull().default("open"),
		url: text("url").notNull(),
		authorLogin: text("authorLogin").notNull().default(""),
		/** When the provider last said it changed. */
		remoteUpdatedAt: timestamp("remoteUpdatedAt"),
		/** When we last asked. */
		syncedAt: timestamp("syncedAt"),
		linkedBy: text("linkedBy")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: now(),
	},
	(table) => [
		uniqueIndex("pull_request_issue_unique").on(table.issueId),
		uniqueIndex("pull_request_unique").on(table.repositoryId, table.number),
	],
);

export const issueLabel = sqliteTable(
	"issue_label",
	{
		issueId: text("issueId")
			.notNull()
			.references(() => issue.id, { onDelete: "cascade" }),
		labelId: text("labelId")
			.notNull()
			.references(() => label.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.issueId, table.labelId] })],
);

export const comment = sqliteTable(
	"comment",
	{
		id: text("id").primaryKey(),
		issueId: text("issueId")
			.notNull()
			.references(() => issue.id, { onDelete: "cascade" }),
		authorId: text("authorId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		body: text("body").notNull(),
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index("comment_issue").on(table.issueId)],
);

/**
 * One thing that happened to an issue, for the details view's timeline.
 *
 * `data` is a JSON snapshot (`{ from, to, labels }`) rather than foreign keys:
 * the timeline is a record of what someone did at the time, so a label renamed
 * or a repository unlinked afterwards must not rewrite what it says. Comments
 * stay in their own table — they are content, not a record of a change — and
 * the client interleaves the two by timestamp.
 */
export const issueActivity = sqliteTable(
	"issue_activity",
	{
		id: text("id").primaryKey(),
		issueId: text("issueId")
			.notNull()
			.references(() => issue.id, { onDelete: "cascade" }),
		actorId: text("actorId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: text("type").$type<ActivityType>().notNull(),
		data: text("data").notNull().default("{}"),
		createdAt: now(),
	},
	(table) => [index("issue_activity_issue").on(table.issueId, table.createdAt)],
);

export const notification = sqliteTable(
	"notification",
	{
		id: text("id").primaryKey(),
		/** Who this lands in the inbox of. */
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Who caused it. Never equal to `userId` — you are not notified of your own actions. */
		actorId: text("actorId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		issueId: text("issueId").references(() => issue.id, { onDelete: "cascade" }),
		type: text("type").$type<NotificationType>().notNull(),
		body: text("body").notNull().default(""),
		readAt: timestamp("readAt"),
		createdAt: now(),
	},
	(table) => [index("notification_user").on(table.userId, table.readAt)],
);

/**
 * An uploaded file. The bytes live in object storage; this row is the record of
 * what they are, who put them there and what they hang off.
 *
 * `status` exists because the upload does not pass through this server: the row
 * is written when a presigned URL is issued and only becomes `ready` once the
 * object is confirmed present, so an abandoned upload leaves a `pending` row
 * rather than a broken attachment.
 */
export const attachment = sqliteTable(
	"attachment",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		/** Object key in the bucket. Generated, never the uploader's filename. */
		key: text("key").notNull().unique(),
		/** What the uploader called it — shown in the UI, sent on download. */
		filename: text("filename").notNull(),
		contentType: text("contentType").notNull(),
		size: integer("size").notNull(),
		status: text("status").$type<"pending" | "ready">().notNull().default("pending"),
		uploadedBy: text("uploadedBy")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		issueId: text("issueId").references(() => issue.id, { onDelete: "cascade" }),
		commentId: text("commentId").references(() => comment.id, { onDelete: "cascade" }),
		createdAt: now(),
	},
	(table) => [
		index("attachment_issue").on(table.issueId),
		index("attachment_comment").on(table.commentId),
		index("attachment_workspace").on(table.workspaceId),
	],
);

export const attachmentRelations = relations(attachment, ({ one }) => ({
	workspace: one(workspace, { fields: [attachment.workspaceId], references: [workspace.id] }),
	issue: one(issue, { fields: [attachment.issueId], references: [issue.id] }),
	comment: one(comment, { fields: [attachment.commentId], references: [comment.id] }),
}));

/**
 * A registered endpoint. `secret` signs every delivery so the receiver can tell
 * a real payload from anything else that finds the URL.
 */
export const webhook = sqliteTable(
	"webhook",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		/** Shown once at creation, then only ever used to sign. */
		secret: text("secret").notNull(),
		description: text("description").notNull().default(""),
		/** JSON array of event names — SQLite has no array type. */
		events: text("events", { mode: "json" }).$type<WebhookEvent[]>().notNull(),
		/**
		 * Extra request headers, as a JSON object. Merged in under the signature
		 * headers, which always win — see `webhooks.server.ts`.
		 */
		headers: text("headers", { mode: "json" })
			.$type<Record<string, string>>()
			.notNull()
			.default({}),
		/**
		 * The condition tree that narrows the subscription, or null to take every
		 * event it is subscribed to. Evaluated at enqueue time.
		 */
		filter: text("filter", { mode: "json" }).$type<WebhookFilter>(),
		/** How the body is shaped — the canonical JSON event, or a `{"text": …}` wrapper. */
		format: text("format").$type<WebhookFormat>().notNull().default("json"),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		createdBy: text("createdBy")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: now(),
	},
	(table) => [index("webhook_workspace").on(table.workspaceId)],
);

/**
 * One row per attempt-set: written *before* anything is sent, so an event is
 * never lost if the process goes away mid-request. This table is the queue —
 * see `webhooks.server.ts`.
 */
export const webhookDelivery = sqliteTable(
	"webhook_delivery",
	{
		id: text("id").primaryKey(),
		webhookId: text("webhookId")
			.notNull()
			.references(() => webhook.id, { onDelete: "cascade" }),
		event: text("event").$type<WebhookEvent>().notNull(),
		/** The exact bytes that were signed and sent. */
		payload: text("payload").notNull(),
		status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		responseStatus: integer("responseStatus"),
		error: text("error"),
		/** When the next attempt becomes due. Null once it is settled. */
		nextAttemptAt: timestamp("nextAttemptAt"),
		deliveredAt: timestamp("deliveredAt"),
		createdAt: now(),
	},
	(table) => [
		index("delivery_webhook").on(table.webhookId, table.createdAt),
		// The drain query: everything still pending and now due.
		index("delivery_due").on(table.status, table.nextAttemptAt),
	],
);

export const webhookRelations = relations(webhook, ({ one, many }) => ({
	workspace: one(workspace, { fields: [webhook.workspaceId], references: [workspace.id] }),
	deliveries: many(webhookDelivery),
}));

export const webhookDeliveryRelations = relations(webhookDelivery, ({ one }) => ({
	webhook: one(webhook, { fields: [webhookDelivery.webhookId], references: [webhook.id] }),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
	members: many(workspaceMember),
	teams: many(team),
	labels: many(label),
	webhooks: many(webhook),
	feedback: many(feedback),
	installations: many(providerInstallation),
	repositories: many(repository),
}));

export const feedbackRelations = relations(feedback, ({ one, many }) => ({
	workspace: one(workspace, { fields: [feedback.workspaceId], references: [workspace.id] }),
	submitter: one(user, { fields: [feedback.submitterUserId], references: [user.id] }),
	labels: many(feedbackLabel),
	comments: many(feedbackComment),
	subscribers: many(feedbackSubscriber),
}));

export const feedbackLabelRelations = relations(feedbackLabel, ({ one }) => ({
	feedback: one(feedback, { fields: [feedbackLabel.feedbackId], references: [feedback.id] }),
	label: one(label, { fields: [feedbackLabel.labelId], references: [label.id] }),
}));

export const feedbackCommentRelations = relations(feedbackComment, ({ one }) => ({
	feedback: one(feedback, { fields: [feedbackComment.feedbackId], references: [feedback.id] }),
	author: one(user, { fields: [feedbackComment.authorId], references: [user.id] }),
}));

export const feedbackSubscriberRelations = relations(feedbackSubscriber, ({ one }) => ({
	feedback: one(feedback, { fields: [feedbackSubscriber.feedbackId], references: [feedback.id] }),
	user: one(user, { fields: [feedbackSubscriber.userId], references: [user.id] }),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
	workspace: one(workspace, { fields: [team.workspaceId], references: [workspace.id] }),
	issues: many(issue),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
	workspace: one(workspace, {
		fields: [workspaceMember.workspaceId],
		references: [workspace.id],
	}),
	user: one(user, { fields: [workspaceMember.userId], references: [user.id] }),
}));

export const issueRelations = relations(issue, ({ one, many }) => ({
	team: one(team, { fields: [issue.teamId], references: [team.id] }),
	feedback: one(feedback, { fields: [issue.feedbackId], references: [feedback.id] }),
	repository: one(repository, { fields: [issue.repositoryId], references: [repository.id] }),
	pullRequest: one(pullRequest, { fields: [issue.id], references: [pullRequest.issueId] }),
	assignee: one(user, { fields: [issue.assigneeId], references: [user.id] }),
	creator: one(user, { fields: [issue.creatorId], references: [user.id] }),
	labels: many(issueLabel),
	comments: many(comment),
}));

export const providerInstallationRelations = relations(providerInstallation, ({ one, many }) => ({
	workspace: one(workspace, {
		fields: [providerInstallation.workspaceId],
		references: [workspace.id],
	}),
	repositories: many(repository),
}));

export const repositoryRelations = relations(repository, ({ one, many }) => ({
	workspace: one(workspace, { fields: [repository.workspaceId], references: [workspace.id] }),
	installation: one(providerInstallation, {
		fields: [repository.installationId],
		references: [providerInstallation.id],
	}),
	files: many(repositoryFile),
	issues: many(issue),
}));

export const repositoryFileRelations = relations(repositoryFile, ({ one }) => ({
	repository: one(repository, {
		fields: [repositoryFile.repositoryId],
		references: [repository.id],
	}),
}));

export const pullRequestRelations = relations(pullRequest, ({ one }) => ({
	issue: one(issue, { fields: [pullRequest.issueId], references: [issue.id] }),
	repository: one(repository, {
		fields: [pullRequest.repositoryId],
		references: [repository.id],
	}),
}));

export const issueLabelRelations = relations(issueLabel, ({ one }) => ({
	issue: one(issue, { fields: [issueLabel.issueId], references: [issue.id] }),
	label: one(label, { fields: [issueLabel.labelId], references: [label.id] }),
}));

export const commentRelations = relations(comment, ({ one }) => ({
	issue: one(issue, { fields: [comment.issueId], references: [issue.id] }),
	author: one(user, { fields: [comment.authorId], references: [user.id] }),
}));

/**
 * One person's authorization of one agent install.
 *
 * Deliberately *not* scoped to a workspace. An MCP client registers once per
 * install and the provider remembers consent per (client, person), so a
 * workspace-scoped grant could never be extended to a second workspace — there
 * would be no second consent screen to ask on. A grant therefore carries what
 * the person can reach, and the per-request membership check is what narrows it.
 *
 * `harness` is what the person said this client is. The bot it acts as is
 * derived from it: one `user` row per harness, app-wide.
 */
export const agentGrant = sqliteTable(
	"agent_grant",
	{
		id: text("id").primaryKey(),
		installedByUserId: text("installedByUserId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/**
		 * The OAuth client this grant was issued to — one install of one harness.
		 *
		 * A token carries `client_id` and the approver's `sub`, and that pair is
		 * what resolves back to a grant. It is also what lets one machine be
		 * revoked without touching another.
		 */
		clientId: text("clientId").notNull(),
		harness: text("harness").$type<HarnessKind>().notNull(),
		/** JSON array of the scopes consented to, for display and revocation. */
		scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
		lastUsedAt: timestamp("lastUsedAt"),
		revokedAt: timestamp("revokedAt"),
		createdAt: now(),
	},
	(table) => [
		// One grant per install per person, and what a token resolves through, so
		// it has to be unique for the lookup to be unambiguous.
		uniqueIndex("agent_grant_unique").on(table.clientId, table.installedByUserId),
		index("agent_grant_installer").on(table.installedByUserId),
	],
);

export const agentGrantRelations = relations(agentGrant, ({ one }) => ({
	installedBy: one(user, {
		fields: [agentGrant.installedByUserId],
		references: [user.id],
	}),
}));

/**
 * A workspace-level issue template: the fields a new issue starts out with.
 *
 * Every prefill is optional in spirit — a template that only sets a team and a
 * label is as valid as one that writes the whole description. Team and assignee
 * are `set null` rather than cascade, so deleting a team does not silently take
 * the templates that pointed at it with it; the composer just falls back to its
 * usual default.
 */
export const issueTemplate = sqliteTable(
	"issue_template",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		/** What the template is called in the New issue menu. */
		name: text("name").notNull(),
		/** One line under the name in settings. Never lands on the issue. */
		summary: text("summary").notNull().default(""),
		/** The prefilled issue title. Blank means "start empty". */
		title: text("title").notNull().default(""),
		description: text("description").notNull().default(""),
		teamId: text("teamId").references(() => team.id, { onDelete: "set null" }),
		status: text("status").$type<IssueStatus>().notNull().default("backlog"),
		priority: text("priority").$type<IssuePriority>().notNull().default("none"),
		assigneeId: text("assigneeId").references(() => user.id, { onDelete: "set null" }),
		createdBy: text("createdBy")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		index("issue_template_workspace").on(table.workspaceId),
		index("issue_template_team").on(table.teamId),
	],
);

/** The labels a template applies. Same shape as `issue_label`. */
export const issueTemplateLabel = sqliteTable(
	"issue_template_label",
	{
		templateId: text("templateId")
			.notNull()
			.references(() => issueTemplate.id, { onDelete: "cascade" }),
		labelId: text("labelId")
			.notNull()
			.references(() => label.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.templateId, table.labelId] })],
);

export const issueTemplateRelations = relations(issueTemplate, ({ one, many }) => ({
	workspace: one(workspace, {
		fields: [issueTemplate.workspaceId],
		references: [workspace.id],
	}),
	team: one(team, { fields: [issueTemplate.teamId], references: [team.id] }),
	assignee: one(user, { fields: [issueTemplate.assigneeId], references: [user.id] }),
	labels: many(issueTemplateLabel),
}));

export const issueTemplateLabelRelations = relations(issueTemplateLabel, ({ one }) => ({
	template: one(issueTemplate, {
		fields: [issueTemplateLabel.templateId],
		references: [issueTemplate.id],
	}),
	label: one(label, { fields: [issueTemplateLabel.labelId], references: [label.id] }),
}));
