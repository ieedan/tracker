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
		createdAt: now(),
		updatedAt: timestamp("updatedAt")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		uniqueIndex("issue_number_unique").on(table.teamId, table.number),
		index("issue_team").on(table.teamId),
		index("issue_assignee").on(table.assigneeId),
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
