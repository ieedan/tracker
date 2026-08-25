/**
 * Provisioning for agents.
 *
 * A bot is an identity, not a credential: it has a `user` row so its writes
 * have a name of their own, and no `account` row, so it can never sign in.
 * What authenticates is the OAuth token a person was issued, and the
 * `agent_grant` behind it is what says how far that token reaches.
 *
 * There is exactly one bot per harness, app-wide — "Claude Code" is the same
 * account in every workspace. It joins a workspace the first time it acts
 * there, on behalf of someone who is already a member, which is what lets one
 * authorization cover every workspace that person can reach.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import { harnessLabel, type HarnessKind } from "@/lib/domain/agents";
import { db } from "./db.server";
import {
	agentGrant,
	oauthAccessToken,
	oauthClient,
	oauthRefreshToken,
	user,
	workspace,
	workspaceMember,
} from "./schema.server";

const installerUser = alias(user, "installer_user");

export interface AgentClient {
	clientId: string;
	name: string;
	icon: string | null;
	uri: string | null;
	/** Dynamically-registered clients are unverified; nothing vouches for them. */
	trusted: boolean;
}

/** The registered client behind an authorization request, for the consent screen. */
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
function botEmail(harness: HarnessKind): string {
	return `${harness}@agents.invalid`;
}

/**
 * The bot for a harness, created the first time anyone connects it.
 *
 * One row app-wide. Two people connecting Claude Code, on four machines, across
 * six workspaces all resolve here — which is the whole reason the members list
 * shows one "Claude Code" rather than one per install.
 */
export async function ensureAgentUser(harness: HarnessKind): Promise<string> {
	const existing = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.type, "agent"), eq(user.harness, harness)))
		.limit(1);

	const found = existing[0];
	if (found !== undefined) return found.id;

	const id = nanoid();
	const now = new Date();
	await db.insert(user).values({
		id,
		name: harnessLabel(harness),
		harness,
		email: botEmail(harness),
		emailVerified: false,
		// Deliberately not the client's `logo_uri`: that is a URL the client
		// chose, and this app never renders one. The mark comes from `harness`.
		image: null,
		type: "agent",
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

/**
 * Makes sure the bot is a member of a workspace it is about to act in.
 *
 * Called from `requireMembership` once the grant behind the request has been
 * checked, so by that point someone with a live grant is already a member here.
 * Idempotent, and a plain `member` row — agents are capped below admin in
 * guards.server.ts, so the role is the floor rather than the ceiling.
 */
export async function ensureAgentMembership(workspaceId: string, botUserId: string): Promise<void> {
	await db
		.insert(workspaceMember)
		.values({
			id: nanoid(),
			workspaceId,
			userId: botUserId,
			// implement:bug:#2: `valid-role` treats any object property named
			// `role` as an ARIA role, including a database column in a server-only
			// file that renders nothing.
			// oxlint-disable-next-line implementjs/valid-role
			role: "member",
		})
		.onConflictDoNothing();
}

/**
 * Records that someone authorized an agent install.
 *
 * Idempotent: authorizing again updates the scopes and harness on that person's
 * grant, which is also how a previously revoked grant comes back.
 */
export async function grantAgentAccess(input: {
	clientId: string;
	installerUserId: string;
	scopes: string[];
	harness: HarnessKind;
}): Promise<void> {
	const { clientId, installerUserId, scopes, harness } = input;

	// Created eagerly so the bot exists — and shows up in settings — before it
	// has done anything, rather than appearing out of nowhere on first use.
	await ensureAgentUser(harness);

	await db
		.insert(agentGrant)
		.values({ id: nanoid(), installedByUserId: installerUserId, clientId, harness, scopes })
		.onConflictDoUpdate({
			target: [agentGrant.clientId, agentGrant.installedByUserId],
			set: { harness, scopes, revokedAt: null },
		});
}

export interface ConnectedAgent {
	grantId: string;
	clientId: string;
	name: string;
	harness: HarnessKind;
	scopes: string[];
	lastUsedAt: Date | null;
	createdAt: Date;
}

/** The agents one person has connected, for their account settings. */
export async function listConnectedAgents(userId: string): Promise<ConnectedAgent[]> {
	const rows = await db
		.select({ grant: agentGrant })
		.from(agentGrant)
		.where(and(eq(agentGrant.installedByUserId, userId), isNull(agentGrant.revokedAt)))
		.orderBy(desc(agentGrant.createdAt));

	return rows.map((row) => ({
		grantId: row.grant.id,
		clientId: row.grant.clientId,
		name: harnessLabel(row.grant.harness),
		harness: row.grant.harness,
		scopes: row.grant.scopes,
		lastUsedAt: row.grant.lastUsedAt,
		createdAt: row.grant.createdAt,
	}));
}

export interface WorkspaceAgent {
	harness: HarnessKind;
	name: string;
	/** The people whose grants let this agent act here. */
	connectedBy: { id: string; name: string }[];
}

/**
 * The agents that can act in one workspace, derived rather than stored.
 *
 * An agent reaches a workspace through a member's grant, so this is "which
 * harnesses have this workspace's members connected" — the honest answer to
 * "who can act here", and it changes the moment someone revokes or leaves.
 */
export async function listWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]> {
	const rows = await db
		.select({ harness: agentGrant.harness, installer: installerUser })
		.from(agentGrant)
		.innerJoin(installerUser, eq(installerUser.id, agentGrant.installedByUserId))
		.innerJoin(
			workspaceMember,
			and(
				eq(workspaceMember.userId, agentGrant.installedByUserId),
				eq(workspaceMember.workspaceId, workspaceId),
			),
		)
		.where(isNull(agentGrant.revokedAt));

	const byHarness = new Map<HarnessKind, WorkspaceAgent>();
	for (const row of rows) {
		const entry = byHarness.get(row.harness) ?? {
			harness: row.harness,
			name: harnessLabel(row.harness),
			connectedBy: [],
		};
		// One person can have several installs of one harness; they are one line
		// here, because the question is who it acts for, not on which machine.
		if (!entry.connectedBy.some((person) => person.id === row.installer.id)) {
			entry.connectedBy.push({ id: row.installer.id, name: row.installer.name });
		}
		byHarness.set(row.harness, entry);
	}
	return [...byHarness.values()];
}

/**
 * Revokes one grant, cutting that install off everywhere it reached.
 *
 * Marking `revokedAt` alone already blocks every API call, because
 * `resolveAgentToken` checks it — but the agent holds an `offline_access`
 * refresh token, and better-auth's token endpoint knows nothing about
 * `agent_grant`, so it would keep minting access tokens that then fail.
 * Revoking at the source is what makes "revoke" mean the credential is dead
 * rather than merely useless.
 *
 * The bot `user` stays: its name is on comments and issues that must keep
 * rendering, and other people's grants of the same harness are untouched.
 */
export async function revokeAgentGrant(userId: string, grantId: string): Promise<boolean> {
	const rows = await db
		.select({ grant: agentGrant })
		.from(agentGrant)
		.where(and(eq(agentGrant.id, grantId), eq(agentGrant.installedByUserId, userId)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) return false;

	const revokedAt = new Date();
	await db.update(agentGrant).set({ revokedAt }).where(eq(agentGrant.id, grantId));

	// Scoped to this client *and* this person: another person's grant of the
	// same agent is untouched.
	const owned = (table: typeof oauthAccessToken | typeof oauthRefreshToken) =>
		and(
			eq(table.clientId, row.grant.clientId),
			eq(table.userId, row.grant.installedByUserId),
			isNull(table.revoked),
		);

	await db.update(oauthRefreshToken).set({ revoked: revokedAt }).where(owned(oauthRefreshToken));
	await db.update(oauthAccessToken).set({ revoked: revokedAt }).where(owned(oauthAccessToken));

	return true;
}

/** Every workspace a person belongs to, for the consent screen's summary. */
export async function workspacesFor(userId: string): Promise<{ slug: string; name: string }[]> {
	return await db
		.select({ slug: workspace.slug, name: workspace.name })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(eq(workspaceMember.userId, userId))
		.orderBy(workspace.name);
}
