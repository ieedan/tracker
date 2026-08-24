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
	/** Issue identifier prefix — the `ENG` in `ENG-42`. */
	key: text("key").notNull(),
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
		workspaceId: text("workspaceId")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		/** Per-workspace counter — the `42` in `ENG-42`. */
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
		uniqueIndex("issue_number_unique").on(table.workspaceId, table.number),
		index("issue_workspace").on(table.workspaceId),
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

export const workspaceRelations = relations(workspace, ({ many }) => ({
	members: many(workspaceMember),
	issues: many(issue),
	labels: many(label),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
	workspace: one(workspace, {
		fields: [workspaceMember.workspaceId],
		references: [workspace.id],
	}),
	user: one(user, { fields: [workspaceMember.userId], references: [user.id] }),
}));

export const issueRelations = relations(issue, ({ one, many }) => ({
	workspace: one(workspace, { fields: [issue.workspaceId], references: [workspace.id] }),
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
