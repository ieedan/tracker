/**
 * Provisioning for agent identities.
 *
 * A bot is an identity, not a credential: it has a `user` row so its writes
 * have a name of their own, a `workspace_member` row so every existing
 * membership check works on it unchanged, and no `account` row, so it can never
 * sign in. What authenticates is the OAuth token a human was issued, and the
 * `agent_grant` behind it is what says how far that token reaches.
 */
import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import { db } from "./db.server";
import { agentGrant, agentIdentity, oauthClient, user, workspaceMember } from "./schema.server";

const installerUser = alias(user, "installer_user");

export interface AgentClient {
	clientId: string;
	name: string;
	icon: string | null;
	uri: string | null;
	/** Dynamically-registered clients are unverified; nothing vouches for them. */
	trusted: boolean;
}

/** The registered client behind a device code, for the consent screen. */
export async function getAgentClient(clientId: string): Promise<AgentClient | null> {
	const rows = await db
		.select()
		.from(oauthClient)
		.where(eq(oauthClient.clientId, clientId))
		.limit(1);

	const row = rows[0];
	if (row === undefined || row.disabled === true) return null;

	return {
		clientId: row.clientId,
		name: row.name ?? "Unnamed application",
		icon: row.icon ?? null,
		uri: row.uri ?? null,
		// Registration is open, so a client is trusted only if we marked it so
		// deliberately. Nothing in the registration flow ever does.
		trusted: row.skipConsent === true,
	};
}

/**
 * The email on a bot's user row.
 *
 * `user.email` is unique and NOT NULL, so a bot needs one. `.invalid` is
 * reserved by RFC 2606 and guaranteed never to resolve, so this address cannot
 * receive mail or collide with a real person's.
 */
function botEmail(clientId: string, workspaceId: string): string {
	return `${clientId}.${workspaceId}@agents.invalid`;
}

/**
 * Records that `installerUserId` authorized `client` to act in `workspaceId`,
 * creating the bot member the first time anyone does.
 *
 * Idempotent: authorizing again re-uses the same bot and updates the scopes on
 * that person's grant, which is also how a previously revoked grant comes back.
 */
export async function grantAgentAccess(input: {
	client: AgentClient;
	workspaceId: string;
	installerUserId: string;
	scopes: string[];
}): Promise<{ agentIdentityId: string; botUserId: string }> {
	const { client, workspaceId, installerUserId, scopes } = input;

	const existing = await db
		.select()
		.from(agentIdentity)
		.where(
			and(eq(agentIdentity.clientId, client.clientId), eq(agentIdentity.workspaceId, workspaceId)),
		)
		.limit(1);

	let identity = existing[0];

	if (identity === undefined) {
		const botUserId = nanoid();
		const now = new Date();

		await db.insert(user).values({
			id: botUserId,
			name: client.name,
			email: botEmail(client.clientId, workspaceId),
			emailVerified: false,
			image: client.icon,
			type: "agent",
			createdAt: now,
			updatedAt: now,
		});

		// A plain member row. Agents are capped below admin in guards.server.ts,
		// so the role here is the floor rather than the ceiling.
		await db.insert(workspaceMember).values({
			id: nanoid(),
			workspaceId,
			userId: botUserId,
			// implement:bug:#2: `valid-role` treats any object property named
			// `role` as an ARIA role, including a database column in a server-only
			// file that renders nothing.
			// oxlint-disable-next-line implementjs/valid-role
			role: "member",
		});

		const inserted = await db
			.insert(agentIdentity)
			.values({ id: nanoid(), userId: botUserId, clientId: client.clientId, workspaceId })
			.returning();

		identity = inserted[0];
		if (identity === undefined) throw new Error("could not create the agent identity");
	}

	await db
		.insert(agentGrant)
		.values({
			id: nanoid(),
			agentIdentityId: identity.id,
			installedByUserId: installerUserId,
			scopes,
		})
		.onConflictDoUpdate({
			target: [agentGrant.agentIdentityId, agentGrant.installedByUserId],
			set: { scopes, revokedAt: null },
		});

	return { agentIdentityId: identity.id, botUserId: identity.userId };
}

export interface InstalledAgent {
	grantId: string;
	clientId: string;
	name: string;
	image: string | null;
	scopes: string[];
	installedBy: { id: string; name: string };
	lastUsedAt: Date | null;
	createdAt: Date;
}

/** Every live grant in a workspace, for the Settings list. */
export async function listInstalledAgents(workspaceId: string): Promise<InstalledAgent[]> {
	const rows = await db
		.select({ grant: agentGrant, identity: agentIdentity, bot: user, installer: installerUser })
		.from(agentGrant)
		.innerJoin(agentIdentity, eq(agentIdentity.id, agentGrant.agentIdentityId))
		.innerJoin(user, eq(user.id, agentIdentity.userId))
		.innerJoin(installerUser, eq(installerUser.id, agentGrant.installedByUserId))
		.where(and(eq(agentIdentity.workspaceId, workspaceId), isNull(agentGrant.revokedAt)));

	return rows.map((row) => ({
		grantId: row.grant.id,
		clientId: row.identity.clientId,
		name: row.bot.name,
		image: row.bot.image ?? null,
		scopes: row.grant.scopes,
		installedBy: { id: row.installer.id, name: row.installer.name },
		lastUsedAt: row.grant.lastUsedAt,
		createdAt: row.grant.createdAt,
	}));
}

/**
 * Revokes one grant, scoped to the workspace so a caller cannot reach into
 * another one by guessing an id.
 *
 * The bot member stays put: its name is on comments and issues that should keep
 * rendering, and removing it would orphan them. It simply has no live grant, so
 * nothing can act as it until someone authorizes the client again.
 */
export async function revokeAgentGrant(workspaceId: string, grantId: string): Promise<boolean> {
	const rows = await db
		.select({ id: agentGrant.id })
		.from(agentGrant)
		.innerJoin(agentIdentity, eq(agentIdentity.id, agentGrant.agentIdentityId))
		.where(and(eq(agentGrant.id, grantId), eq(agentIdentity.workspaceId, workspaceId)))
		.limit(1);

	if (rows[0] === undefined) return false;

	await db.update(agentGrant).set({ revokedAt: new Date() }).where(eq(agentGrant.id, grantId));
	return true;
}
