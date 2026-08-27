import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createAuthClient } from "better-auth/client";
import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { scopesToPermissions } from "@/lib/domain/agents";
import type { ApiKeyPermissions } from "@/lib/domain/api-keys";
import { auth, MCP_RESOURCE, OAUTH_ISSUER } from "./auth.server";
import { db } from "./db.server";
import { agentGrant, user } from "./schema.server";

const installerUser = alias(user, "installer_user");

/**
 * Verifies access tokens against our own issuer.
 *
 * Handing it the local `auth` instance lets it read the issuer and JWKS
 * straight from the running server, so verification is an in-process signature
 * check rather than an HTTP round trip back to ourselves.
 */
const resourceClient = createAuthClient({
	plugins: [oauthProviderResourceClient(auth)],
});

export interface AgentPrincipal {
	/** The bot. This becomes `locals.user`, so it is what writes are stamped with. */
	user: App.SessionUser;
	grantId: string;
	/** The person who authorized it — the ceiling on what the agent may do. */
	installedByUserId: string;
	clientId: string;
	permissions: ApiKeyPermissions;
}

/**
 * Resolves an agent access token to the bot it acts as.
 *
 * Tokens are audience-bound JWTs, because the MCP endpoint is registered as an
 * OAuth resource. That means there is no row to look up — a JWT is verified by
 * signature, not by storage — so revocation cannot work by deleting one. It
 * works through `agent_grant` instead, which is read on every request here, and
 * which is why revoking in Settings takes effect immediately rather than
 * whenever the current hour-long token happens to expire.
 *
 * The `aud` check is what MCP requires of a resource server: a token minted for
 * anything else must be rejected, never merely accepted-and-ignored.
 *
 * The token's `sub` is the person who approved it; OAuth has no way to say
 * "issued to a bot". The bot is resolved here from `client_id` + `sub`, which
 * is exactly the pair a grant is keyed on. `null` means "not a usable token",
 * and the caller treats that as unauthenticated.
 *
 * Permissions come from the grant, not the JWT's `scope` claim. A dynamically
 * registered MCP client usually gets the registration default set stamped on
 * the token — which deliberately omits opt-in scopes like webhooks — even when
 * the authorize URL and the consent screen listed them and `grantAgentAccess`
 * recorded them. Intersecting token ∩ grant then strips everything the person
 * just approved (ENG-30). The grant is the human's decision and is what
 * Settings revokes against, so it is the ACL; the JWT only proves the call is
 * this install.
 *
 * No workspace is resolved here, because a grant does not name one — which
 * workspace an agent may act in is decided per request, by `requireMembership`
 * checking that the approver is still a member of the one being asked for.
 */
export async function resolveAgentToken(presented: string): Promise<AgentPrincipal | null> {
	let payload: Record<string, unknown>;
	try {
		payload = (await resourceClient.verifyBearerToken(presented, {
			// Both are required. Without `issuer` the check fails as a flat
			// "invalid access token", which reads like a bad credential rather
			// than a missing option.
			verifyOptions: { audience: MCP_RESOURCE, issuer: OAUTH_ISSUER },
		})) as Record<string, unknown>;
	} catch {
		// Expired, wrong audience, bad signature, not a JWT — all unauthenticated.
		return null;
	}

	const installedByUserId = typeof payload.sub === "string" ? payload.sub : null;
	const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
	if (installedByUserId === null || clientId === null) return null;

	// The bot is joined on `user.harness`, which is what makes every install of
	// a harness resolve to the same account.
	const rows = await db
		.select({ grant: agentGrant, bot: user, installer: installerUser })
		.from(agentGrant)
		.innerJoin(user, and(eq(user.type, "agent"), eq(user.harness, agentGrant.harness)))
		.innerJoin(installerUser, eq(installerUser.id, agentGrant.installedByUserId))
		.where(
			and(
				eq(agentGrant.clientId, clientId),
				eq(agentGrant.installedByUserId, installedByUserId),
				isNull(agentGrant.revokedAt),
			),
		)
		.limit(1);

	const row = rows[0];
	if (row === undefined) return null;

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
			harness: row.bot.harness ?? "other",
			onBehalfOf: { id: row.installer.id, name: row.installer.name },
		},
		grantId: row.grant.id,
		installedByUserId: row.grant.installedByUserId,
		clientId: row.grant.clientId,
		permissions: scopesToPermissions(row.grant.scopes.join(" ")),
	};
}
