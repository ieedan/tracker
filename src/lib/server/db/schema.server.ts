import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Ids are generated in the app rather than by the database so a row can be
 * built, referenced, and returned without a round trip.
 */
const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
	timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/*                                    auth                                    */
/* -------------------------------------------------------------------------- */
/* These four tables are better-auth's core schema, plus the apiKey plugin's.  */
/* Their column names are fixed by better-auth — do not rename them.           */

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	/** The GitHub login (`octocat`), mirrored out of the account for cheap lookups. */
	githubLogin: text("github_login"),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		issuer: text("issuer").notNull(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apikey = pgTable(
	"apikey",
	{
		id: text("id").primaryKey(),
		configId: text("config_id").notNull(),
		name: text("name"),
		start: text("start"),
		/** The owning entity — a user id, under our configuration. */
		referenceId: text("reference_id").notNull(),
		prefix: text("prefix"),
		/** Hashed, never the key itself. */
		key: text("key").notNull(),
		refillInterval: integer("refill_interval"),
		refillAmount: integer("refill_amount"),
		lastRefillAt: timestamp("last_refill_at", { withTimezone: true }),
		enabled: boolean("enabled").notNull().default(true),
		rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(true),
		rateLimitTimeWindow: integer("rate_limit_time_window"),
		rateLimitMax: integer("rate_limit_max"),
		requestCount: integer("request_count").notNull().default(0),
		remaining: integer("remaining"),
		lastRequest: timestamp("last_request", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		permissions: text("permissions"),
		metadata: text("metadata"),
	},
	(t) => [
		index("apikey_reference_idx").on(t.referenceId),
		index("apikey_key_idx").on(t.key),
		index("apikey_config_idx").on(t.configId),
	],
);

/* -------------------------------------------------------------------------- */
/*                                 workspaces                                 */
/* -------------------------------------------------------------------------- */

/**
 * One row per GitHub owner — a user account or an organization. Membership is
 * not stored: GitHub is the source of truth, so access is decided by asking
 * GitHub what the caller belongs to (see `access.server.ts`).
 */
export const workspace = pgTable(
	"workspace",
	{
		id: id(),
		/** GitHub's numeric owner id. Stable across renames, which logins are not. */
		githubId: integer("github_id").notNull().unique(),
		/** The owner's login, e.g. `acme`. Also the URL segment. */
		slug: text("slug").notNull().unique(),
		name: text("name").notNull(),
		avatarUrl: text("avatar_url"),
		type: text("type", { enum: ["User", "Organization"] }).notNull(),
		/** Identifier prefix for issues that are not scoped to a repo. */
		prefix: text("prefix").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("workspace_slug_idx").on(t.slug)],
);

/** A repo belonging to a workspace, mirrored from GitHub so issues can point at one. */
export const repo = pgTable(
	"repo",
	{
		id: id(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		githubId: integer("github_id").notNull().unique(),
		/** Repo name without the owner, e.g. `api`. Also the issue prefix. */
		name: text("name").notNull(),
		description: text("description"),
		isPrivate: boolean("is_private").notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [uniqueIndex("repo_workspace_name_idx").on(t.workspaceId, t.name)],
);

/* -------------------------------------------------------------------------- */
/*                             issue configuration                            */
/* -------------------------------------------------------------------------- */

/**
 * Workspace-owned statuses, seeded with Linear's defaults on creation.
 * `category` is what board grouping and "is it done" logic reads, so a renamed
 * status still behaves correctly.
 */
export const status = pgTable(
	"status",
	{
		id: id(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		category: text("category", {
			enum: ["backlog", "unstarted", "started", "completed", "canceled"],
		}).notNull(),
		color: text("color").notNull(),
		position: integer("position").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("status_workspace_idx").on(t.workspaceId, t.position)],
);

export const label = pgTable(
	"label",
	{
		id: id(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull(),
		description: text("description"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [uniqueIndex("label_workspace_name_idx").on(t.workspaceId, t.name)],
);

/* -------------------------------------------------------------------------- */
/*                                   issues                                   */
/* -------------------------------------------------------------------------- */

/**
 * The counter behind human-readable identifiers. One row per prefix per
 * workspace: repo-scoped issues count under the repo name, unscoped issues
 * count under the workspace prefix. Incremented with an atomic upsert so two
 * concurrent creates cannot claim the same number.
 */
export const issueCounter = pgTable(
	"issue_counter",
	{
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		prefix: text("prefix").notNull(),
		next: integer("next").notNull().default(1),
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.prefix] })],
);

export const issue = pgTable(
	"issue",
	{
		id: id(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		/** Null when the issue belongs to the workspace rather than one repo. */
		repoId: text("repo_id").references(() => repo.id, { onDelete: "set null" }),
		/** `api-12` or `acme-3`. Frozen at creation, so moving repos keeps the link alive. */
		identifier: text("identifier").notNull(),
		number: integer("number").notNull(),
		/** Markdown. Rendered to an inline-only subset for display. */
		title: text("title").notNull(),
		/** Markdown. Rendered to sanitized HTML for display. */
		description: text("description").notNull().default(""),
		statusId: text("status_id")
			.notNull()
			.references(() => status.id, { onDelete: "restrict" }),
		/** 0 none, 1 urgent, 2 high, 3 medium, 4 low — Linear's ordering. */
		priority: integer("priority").notNull().default(0),
		assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
		creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
		/** Fractional index, so a drag between two issues never rewrites the list. */
		position: text("position").notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		canceledAt: timestamp("canceled_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("issue_workspace_identifier_idx").on(t.workspaceId, t.identifier),
		index("issue_workspace_status_idx").on(t.workspaceId, t.statusId),
		index("issue_repo_idx").on(t.repoId),
		index("issue_assignee_idx").on(t.assigneeId),
		index("issue_updated_idx").on(t.workspaceId, t.updatedAt),
	],
);

export const issueLabel = pgTable(
	"issue_label",
	{
		issueId: text("issue_id")
			.notNull()
			.references(() => issue.id, { onDelete: "cascade" }),
		labelId: text("label_id")
			.notNull()
			.references(() => label.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.issueId, t.labelId] }), index("issue_label_label_idx").on(t.labelId)],
);

export const comment = pgTable(
	"comment",
	{
		id: id(),
		issueId: text("issue_id")
			.notNull()
			.references(() => issue.id, { onDelete: "cascade" }),
		authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
		/** Markdown. */
		body: text("body").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("comment_issue_idx").on(t.issueId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/*                              files & webhooks                              */
/* -------------------------------------------------------------------------- */

export const attachment = pgTable(
	"attachment",
	{
		id: id(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		/** The object key in the bucket. Contains a random segment — this is the secret. */
		key: text("key").notNull().unique(),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		size: integer("size").notNull(),
		uploadedById: text("uploaded_by_id").references(() => user.id, { onDelete: "set null" }),
		createdAt: createdAt(),
	},
	(t) => [index("attachment_workspace_idx").on(t.workspaceId)],
);

export const webhook = pgTable(
	"webhook",
	{
		id: id(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		/** Shared secret for the `X-Tracker-Signature` HMAC. */
		secret: text("secret").notNull(),
		/** Event names this endpoint wants, e.g. `["issue.created"]`. */
		events: jsonb("events").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
		enabled: boolean("enabled").notNull().default(true),
		/** Delivery is fire-and-forget; these three are the whole audit trail. */
		lastStatus: integer("last_status"),
		lastError: text("last_error"),
		lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("webhook_workspace_idx").on(t.workspaceId)],
);

/* -------------------------------------------------------------------------- */
/*                                  relations                                 */
/* -------------------------------------------------------------------------- */

export const workspaceRelations = relations(workspace, ({ many }) => ({
	repos: many(repo),
	statuses: many(status),
	labels: many(label),
	issues: many(issue),
	webhooks: many(webhook),
}));

export const repoRelations = relations(repo, ({ one, many }) => ({
	workspace: one(workspace, { fields: [repo.workspaceId], references: [workspace.id] }),
	issues: many(issue),
}));

export const issueRelations = relations(issue, ({ one, many }) => ({
	workspace: one(workspace, { fields: [issue.workspaceId], references: [workspace.id] }),
	repo: one(repo, { fields: [issue.repoId], references: [repo.id] }),
	status: one(status, { fields: [issue.statusId], references: [status.id] }),
	assignee: one(user, { fields: [issue.assigneeId], references: [user.id], relationName: "assignee" }),
	creator: one(user, { fields: [issue.creatorId], references: [user.id], relationName: "creator" }),
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

export const statusRelations = relations(status, ({ one }) => ({
	workspace: one(workspace, { fields: [status.workspaceId], references: [workspace.id] }),
}));

export const labelRelations = relations(label, ({ one }) => ({
	workspace: one(workspace, { fields: [label.workspaceId], references: [workspace.id] }),
}));

export type Workspace = typeof workspace.$inferSelect;
export type Repo = typeof repo.$inferSelect;
export type Status = typeof status.$inferSelect;
export type Label = typeof label.$inferSelect;
export type Issue = typeof issue.$inferSelect;
export type Comment = typeof comment.$inferSelect;
export type Attachment = typeof attachment.$inferSelect;
export type Webhook = typeof webhook.$inferSelect;
export type User = typeof user.$inferSelect;
