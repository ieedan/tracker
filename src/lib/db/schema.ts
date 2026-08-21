import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const issues = sqliteTable("issues", {
	id: integer().primaryKey({ autoIncrement: true }),
	title: text().notNull(),
	body: text(),
	status: text({ enum: ["open", "closed"] }).notNull().default("open"),
	createdAt: integer()
		.notNull()
		.$defaultFn(() => Date.now()),
	updatedAt: integer()
		.notNull()
		.$defaultFn(() => Date.now()),
});

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
