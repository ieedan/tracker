// Mirrors the tables `better-auth` asks for, as reported by `getSchema()` from
// better-auth@1.7.1 plus @better-auth/api-key@1.7.1. Column names are the
// `fieldName`s better-auth uses, so they stay camelCase on purpose.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
});

export const session = sqliteTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expiresAt").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	ipAddress: text("ipAddress"),
	userAgent: text("userAgent"),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
	id: text("id").primaryKey(),
	issuer: text("issuer").notNull(),
	accountId: text("accountId").notNull(),
	providerId: text("providerId").notNull(),
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("accessToken"),
	refreshToken: text("refreshToken"),
	idToken: text("idToken"),
	accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
	refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expiresAt").notNull(),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
});

// `referenceId` is polymorphic in the plugin (user or organization), so it
// carries no foreign key.
export const apikey = sqliteTable("apikey", {
	id: text("id").primaryKey(),
	configId: text("configId").notNull().default("default"),
	name: text("name"),
	start: text("start"),
	referenceId: text("referenceId").notNull(),
	prefix: text("prefix"),
	key: text("key").notNull(),
	refillInterval: integer("refillInterval"),
	refillAmount: integer("refillAmount"),
	lastRefillAt: timestamp("lastRefillAt"),
	enabled: integer("enabled", { mode: "boolean" }).default(true),
	rateLimitEnabled: integer("rateLimitEnabled", { mode: "boolean" }).default(true),
	rateLimitTimeWindow: integer("rateLimitTimeWindow").default(86400000),
	rateLimitMax: integer("rateLimitMax").default(10),
	requestCount: integer("requestCount").default(0),
	remaining: integer("remaining"),
	lastRequest: timestamp("lastRequest"),
	expiresAt: timestamp("expiresAt"),
	createdAt: timestamp("createdAt").notNull(),
	updatedAt: timestamp("updatedAt").notNull(),
	permissions: text("permissions"),
	metadata: text("metadata"),
});
