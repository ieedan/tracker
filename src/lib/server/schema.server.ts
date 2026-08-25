import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
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
import type { DeliveryStatus, WebhookEvent } from "@/lib/domain/webhooks";
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
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		uniqueIndex("issue_number_unique").on(table.teamId, table.number),
		index("issue_team").on(table.teamId),
		index("issue_assignee").on(table.assigneeId),
		uniqueIndex("issue_feedback_unique").on(table.feedbackId),
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
	assignee: one(user, { fields: [issue.assigneeId], references: [user.id] }),
	creator: one(user, { fields: [issue.creatorId], references: [user.id] }),
	labels: many(issueLabel),
	comments: many(comment),
}));

export const issueLabelRelations = relations(issueLabel, ({ one }) => ({
	issue: one(issue, { fields: [issueLabel.issueId], references: [issue.id] }),
	label: one(label, { fields: [issueLabel.labelId], references: [label.id] }),
}));

export const commentRelations = relations(comment, ({ one }) => ({
	issue: one(issue, { fields: [comment.issueId], references: [issue.id] }),
	author: one(user, { fields: [comment.authorId], references: [user.id] }),
}));
