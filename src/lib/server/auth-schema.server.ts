// Mirrors the tables `better-auth` asks for, as reported by `getSchema()` from
// better-auth@1.7.1 plus @better-auth/api-key@1.7.1 and
// @better-auth/oauth-provider@1.7.1. Column names are the `fieldName`s
// better-auth uses, so they stay camelCase on purpose.
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { HarnessKind, UserType } from "@/lib/domain/agents";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

// better-auth declares some fields as `string[]` / `json`, and serialises them
// itself before handing them to drizzle. They are therefore plain text columns
// holding a JSON string — `mode: "json"` here would encode a second time and
// store `"\"[\\\"a\\\"]\""`. Same reason `apikey.permissions` is a bare
// text column, and why `parsePermissions` accepts a string.
const jsonList = (name: string) => text(name);
const json = (name: string) => text(name);

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	/**
	 * "agent" rows are bot members, created when an OAuth client is authorized
	 * into a workspace. They have no `account` row, so they can never sign in —
	 * they exist so an agent's writes have an identity of their own to carry.
	 */
	type: text("type").$type<UserType>().notNull().default("human"),
	/**
	 * For an agent, which coding agent it is — `null` for a person.
	 *
	 * Lives here rather than on `agent_identity` (which it is 1:1 with) so every
	 * place that already loads a user can show the right mark without a join.
	 */
	harness: text("harness").$type<HarnessKind>(),
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

// ---------------------------------------------------------------------------
// jwt — signs the access tokens the OAuth provider issues.
// ---------------------------------------------------------------------------

export const jwks = sqliteTable("jwks", {
	id: text("id").primaryKey(),
	publicKey: text("publicKey").notNull(),
	privateKey: text("privateKey").notNull(),
	alg: text("alg"),
	crv: text("crv"),
	createdAt: timestamp("createdAt").notNull(),
	expiresAt: timestamp("expiresAt"),
});

// ---------------------------------------------------------------------------
// @better-auth/oauth-provider
// ---------------------------------------------------------------------------

export const oauthClient = sqliteTable("oauthClient", {
	id: text("id").primaryKey(),
	clientId: text("clientId").notNull().unique(),
	clientSecret: text("clientSecret"),
	clientDiscoveryId: text("clientDiscoveryId"),
	disabled: integer("disabled", { mode: "boolean" }).default(false),
	/**
	 * Never set for a dynamically-registered client. Consent is the only thing
	 * standing between an open registration endpoint and an agent acting in
	 * someone's workspace, so it is not skippable here.
	 */
	skipConsent: integer("skipConsent", { mode: "boolean" }),
	enableEndSession: integer("enableEndSession", { mode: "boolean" }),
	subjectType: text("subjectType"),
	scopes: jsonList("scopes"),
	clientCredentialsScopes: jsonList("clientCredentialsScopes"),
	userId: text("userId").references(() => user.id),
	name: text("name"),
	uri: text("uri"),
	icon: text("icon"),
	contacts: jsonList("contacts"),
	tos: text("tos"),
	policy: text("policy"),
	softwareId: text("softwareId"),
	softwareVersion: text("softwareVersion"),
	softwareStatement: text("softwareStatement"),
	redirectUris: jsonList("redirectUris").notNull(),
	postLogoutRedirectUris: jsonList("postLogoutRedirectUris"),
	backchannelLogoutUri: text("backchannelLogoutUri"),
	backchannelLogoutSessionRequired: integer("backchannelLogoutSessionRequired", {
		mode: "boolean",
	}),
	tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
	applicationType: text("applicationType"),
	jwks: text("jwks"),
	jwksUri: text("jwksUri"),
	grantTypes: jsonList("grantTypes"),
	responseTypes: jsonList("responseTypes"),
	requirePKCE: integer("requirePKCE", { mode: "boolean" }),
	dpopBoundAccessTokens: integer("dpopBoundAccessTokens", { mode: "boolean" }).default(false),
	referenceId: text("referenceId"),
	metadata: json("metadata"),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt"),
});

export const oauthResource = sqliteTable("oauthResource", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull().unique(),
	name: text("name").notNull(),
	accessTokenTtl: integer("accessTokenTtl"),
	refreshTokenTtl: integer("refreshTokenTtl"),
	signingAlgorithm: text("signingAlgorithm"),
	signingKeyId: text("signingKeyId"),
	allowedScopes: jsonList("allowedScopes"),
	customClaims: json("customClaims"),
	dpopBoundAccessTokensRequired: integer("dpopBoundAccessTokensRequired", {
		mode: "boolean",
	}).default(false),
	disabled: integer("disabled", { mode: "boolean" }).default(false),
	policyVersion: integer("policyVersion").default(1),
	metadata: json("metadata"),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt"),
});

export const oauthClientResource = sqliteTable(
	"oauthClientResource",
	{
		id: text("id").primaryKey(),
		clientId: text("clientId")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		resourceId: text("resourceId")
			.notNull()
			.references(() => oauthResource.identifier, { onDelete: "cascade" }),
		metadata: json("metadata"),
		createdAt: timestamp("createdAt"),
	},
	(table) => [uniqueIndex("oauthClientResource_unique").on(table.clientId, table.resourceId)],
);

export const oauthRefreshToken = sqliteTable("oauthRefreshToken", {
	id: text("id").primaryKey(),
	token: text("token").notNull().unique(),
	clientId: text("clientId")
		.notNull()
		.references(() => oauthClient.clientId),
	sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
	userId: text("userId")
		.notNull()
		.references(() => user.id),
	referenceId: text("referenceId"),
	authorizationCodeId: text("authorizationCodeId"),
	resources: jsonList("resources"),
	requestedUserInfoClaims: jsonList("requestedUserInfoClaims"),
	scopes: jsonList("scopes").notNull(),
	expiresAt: timestamp("expiresAt"),
	createdAt: timestamp("createdAt"),
	revoked: timestamp("revoked"),
	rotatedAt: timestamp("rotatedAt"),
	rotationReplayResponse: text("rotationReplayResponse"),
	rotationReplayExpiresAt: timestamp("rotationReplayExpiresAt"),
	authTime: timestamp("authTime"),
	confirmation: json("confirmation"),
});

export const oauthAccessToken = sqliteTable("oauthAccessToken", {
	id: text("id").primaryKey(),
	token: text("token").unique(),
	clientId: text("clientId")
		.notNull()
		.references(() => oauthClient.clientId),
	sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
	userId: text("userId").references(() => user.id),
	referenceId: text("referenceId"),
	authorizationCodeId: text("authorizationCodeId"),
	resources: jsonList("resources"),
	requestedUserInfoClaims: jsonList("requestedUserInfoClaims"),
	refreshId: text("refreshId").references(() => oauthRefreshToken.id),
	scopes: jsonList("scopes").notNull(),
	expiresAt: timestamp("expiresAt"),
	createdAt: timestamp("createdAt"),
	revoked: timestamp("revoked"),
	confirmation: json("confirmation"),
});

export const oauthConsent = sqliteTable("oauthConsent", {
	id: text("id").primaryKey(),
	clientId: text("clientId")
		.notNull()
		.references(() => oauthClient.clientId),
	userId: text("userId").references(() => user.id),
	referenceId: text("referenceId"),
	resources: jsonList("resources"),
	requestedUserInfoClaims: jsonList("requestedUserInfoClaims"),
	scopes: jsonList("scopes").notNull(),
	createdAt: timestamp("createdAt"),
	updatedAt: timestamp("updatedAt"),
});

export const oauthClientAssertion = sqliteTable("oauthClientAssertion", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expiresAt").notNull(),
});

/** RFC 8628 device + user codes, in the OAuth-aware build of the plugin. */
export const deviceCode = sqliteTable(
	"deviceCode",
	{
		id: text("id").primaryKey(),
		deviceCode: text("deviceCode").notNull(),
		userCode: text("userCode").notNull(),
		userId: text("userId"),
		status: text("status").notNull(),
		clientId: text("clientId"),
		oauthClientId: text("oauthClientId"),
		scope: text("scope"),
		resources: jsonList("resources"),
		pollingInterval: integer("pollingInterval"),
		lastPolledAt: timestamp("lastPolledAt"),
		expiresAt: timestamp("expiresAt").notNull(),
	},
	(table) => [
		uniqueIndex("deviceCode_deviceCode_unique").on(table.deviceCode),
		uniqueIndex("deviceCode_userCode_unique").on(table.userCode),
	],
);
