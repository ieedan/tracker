import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { scopesToPermissions } from "@/lib/domain/agents";
import type { ApiKeyPermissions } from "@/lib/domain/api-keys";
import { db } from "./db.server";
import { agentGrant, agentIdentity, oauthAccessToken, user } from "./schema.server";

const installerUser = alias(user, "installer_user");

export interface AgentPrincipal {
	/** The bot. This becomes `locals.user`, so it is what writes are stamped with. */
	user: App.SessionUser;
	agentIdentityId: string;
	/** The one workspace this grant covers. */
	workspaceId: string;
	/** The human who authorized it — the ceiling on what the agent may do. */
	installedByUserId: string;
	clientId: string;
	permissions: ApiKeyPermissions;
}

/**
 * How the OAuth provider stores an access token: SHA-256, base64url, unpadded.
 *
 * The provider hashes tokens at rest but keeps its hasher internal, so this
 * mirrors it — the same construction the api-key plugin uses. The round trip is
 * exercised end to end, so if the provider ever changes it, every agent token
 * stops resolving at once rather than quietly resolving to the wrong one.
 */
async function hashToken(presented: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presented));
	return btoa(String.fromCodePoint(...new Uint8Array(digest)))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

/**
 * Resolves an OAuth access token to the bot it acts as.
 *
 * Like `resolveApiKey`, this looks the credential up directly rather than going
 * through better-auth's session machinery: the token identifies an agent, and
 * an agent must never be able to reach `/api/auth/*` as if it were the human
 * who authorized it. Tokens are opaque here — the provider issues JWTs only for
 * a registered resource audience — so there is nothing to verify offline, and
 * the lookup is also what makes a revoked grant take effect immediately.
 *
 * `oauthAccessToken.userId` is that human; OAuth has no way to say "issued to a
 * bot". The bot identity is resolved here instead, from the client the token
 * was issued to plus the workspace that human granted it. `null` means "not a
 * usable token", and the caller treats it exactly like a bad API key.
 */
export async function resolveAgentToken(presented: string): Promise<AgentPrincipal | null> {
	const hashed = await hashToken(presented);

	const rows = await db
		.select({
			token: oauthAccessToken,
			grant: agentGrant,
			identity: agentIdentity,
			bot: user,
			installer: installerUser,
		})
		.from(oauthAccessToken)
		.innerJoin(agentIdentity, eq(agentIdentity.clientId, oauthAccessToken.clientId))
		.innerJoin(
			agentGrant,
			and(
				eq(agentGrant.agentIdentityId, agentIdentity.id),
				eq(agentGrant.installedByUserId, oauthAccessToken.userId),
			),
		)
		.innerJoin(user, eq(user.id, agentIdentity.userId))
		.innerJoin(installerUser, eq(installerUser.id, agentGrant.installedByUserId))
		.where(and(eq(oauthAccessToken.token, hashed), isNull(agentGrant.revokedAt)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) return null;
	if (row.token.revoked !== null) return null;
	if (row.token.expiresAt !== null && row.token.expiresAt.getTime() <= Date.now()) return null;

	// Best-effort usage stamp — a failure here must not fail the request.
	void db
		.update(agentGrant)
		.set({ lastUsedAt: new Date() })
		.where(eq(agentGrant.id, row.grant.id))
		.catch(() => undefined);

	return {
		user: {
			id: row.bot.id,
			name: row.bot.name,
			email: row.bot.email,
			image: row.bot.image ?? null,
			type: "agent",
			onBehalfOf: { id: row.installer.id, name: row.installer.name },
		},
		agentIdentityId: row.identity.id,
		workspaceId: row.identity.workspaceId,
		installedByUserId: row.grant.installedByUserId,
		clientId: row.identity.clientId,
		// The token's own scopes intersected with the grant's, so narrowing a
		// grant in Settings takes effect without waiting for tokens to expire.
		permissions: intersect(
			scopesToPermissions(parseScopes(row.token.scopes).join(" ")),
			scopesToPermissions(row.grant.scopes.join(" ")),
		),
	};
}

/** The provider stores `scopes` as a JSON array in a text column. */
function parseScopes(raw: string | null): string[] {
	if (raw === null || raw === "") return [];
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value)) return [];
		return value.filter((entry): entry is string => typeof entry === "string");
	} catch {
		return [];
	}
}

function intersect(a: ApiKeyPermissions, b: ApiKeyPermissions): ApiKeyPermissions {
	const result: ApiKeyPermissions = {};
	for (const [resource, actions] of Object.entries(a) as [
		keyof ApiKeyPermissions,
		ApiKeyPermissions[keyof ApiKeyPermissions],
	][]) {
		const other = b[resource] ?? [];
		const shared = (actions ?? []).filter((action) => other.includes(action));
		if (shared.length > 0) result[resource] = shared;
	}
	return result;
}
