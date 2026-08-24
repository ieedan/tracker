import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { PRIORITIES, STATUSES } from "../constants";

function defaultFields() {
	return {
		createdAt: int({ mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: int({ mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date())
			.$onUpdateFn(() => new Date()),
	};
}

export const teams = sqliteTable("teams", {
	...defaultFields(),
	id: int().primaryKey({ autoIncrement: true }),
	name: text().notNull(),
	shortHand: text().notNull().unique(),
});

export const labels = sqliteTable("labels", {
	...defaultFields(),
	id: int().primaryKey({ autoIncrement: true }),
	name: text().notNull().unique(),
	description: text().notNull(),
	color: text().notNull(),
});

export const issues = sqliteTable(
	"issues",
	{
		...defaultFields(),
		// <team-slug>-000
		id: int().primaryKey({ autoIncrement: true }),
		teamId: int().notNull(),
		title: text().notNull(),
		body: text().notNull(),
		status: text({ enum: STATUSES }).notNull(),
		priority: text({ enum: PRIORITIES }).notNull().default("None"),
		assignee: int(),
		assignedAt: int({ mode: "timestamp_ms" }),
	},
	(table) => [
		index("team_idx").on(table.teamId),
		index("status_idx").on(table.status),
		index("priority_idx").on(table.priority),
		index("assignee").on(table.assignee),
	],
);

export const issueLabels = sqliteTable(
	"issueLabels",
	{
		...defaultFields(),
		id: int().primaryKey({ autoIncrement: true }),
		issueId: int(),
		labelId: int(),
	},
	(table) => [
		index("issue_id_idx").on(table.issueId),
		uniqueIndex("issue_labels_unique_idx").on(table.issueId, table.labelId),
	],
);
