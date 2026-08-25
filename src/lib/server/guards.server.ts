import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { hasPermission, type ApiKeyAction, type ApiKeyResource } from "@/lib/domain/api-keys";
import type { WorkspaceRole } from "@/lib/domain/issues";
import { db } from "./db.server";
import { workspace, workspaceMember } from "./schema.server";

export interface Membership {
	user: App.SessionUser;
	workspace: typeof workspace.$inferSelect;
	role: WorkspaceRole;
}

/** 401s a request with no session and no valid credential. */
export function requireUser(locals: App.Locals): App.SessionUser {
	if (locals.user === null) error(401, "authentication required");
	return locals.user;
}

/**
 * 401s an unauthenticated caller, 404s a workspace they cannot see.
 *
 * A non-member gets 404 rather than 403 on purpose: whether a slug exists is
 * itself information, and there is no reason to leak it.
 *
 * An agent is held to three extra conditions, all of which 404 for the same
 * reason. Its token is bound to one workspace; the human who authorized it must
 * still be a member; and it is capped at `member`, never `admin` — see
 * `agentMembership` below.
 */
export async function requireMembership(locals: App.Locals, slug: string): Promise<Membership> {
	const user = requireUser(locals);

	const rows = await db
		.select({ workspace, role: workspaceMember.role })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, user.id)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, `no workspace "${slug}"`);

	const membership: Membership = { user, workspace: row.workspace, role: row.role };
	if (locals.agent === null) return membership;
	return await agentMembership(membership, locals.agent, slug);
}

/**
 * Caps an agent's membership at what its grant actually allows.
 *
 * An agent can never be more capable than the person who set it up, and never
 * an admin. Returning `member` here is what enforces the second half for every
 * admin-gated route at once, since `requireAdmin` reads this role.
 */
async function agentMembership(
	membership: Membership,
	agent: App.AgentContext,
	slug: string,
): Promise<Membership> {
	// A grant covers one workspace. Without this, a bot that is a member of two
	// workspaces could act in either — which `transfer` would happily use to
	// move issues into a workspace nobody granted access to.
	if (agent.workspaceId !== membership.workspace.id) error(404, `no workspace "${slug}"`);

	// The grant is delegated access, so it dies when the delegation does.
	const installer = await db
		.select({ role: workspaceMember.role })
		.from(workspaceMember)
		.where(
			and(
				eq(workspaceMember.workspaceId, membership.workspace.id),
				eq(workspaceMember.userId, agent.installedByUserId),
			),
		)
		.limit(1);

	if (installer[0] === undefined) error(404, `no workspace "${slug}"`);

	// implement:bug:#2: `valid-role` treats any object property named `role` as
	// an ARIA role, including a workspace role in a server-only file.
	// oxlint-disable-next-line implementjs/valid-role
	return { ...membership, role: "member" };
}

/** Admin-only actions: managing members, invites and workspace settings. */
export function requireAdmin(membership: Membership): Membership {
	if (membership.role !== "admin") error(403, "admin role required");
	return membership;
}

/**
 * Some things a bearer credential must not do — notably minting more keys. Key
 * management stays on the interactive session, for API keys and agents alike.
 */
export function requireInteractiveSession(locals: App.Locals): App.SessionUser {
	const user = requireUser(locals);
	if (locals.authVia !== "session") {
		error(403, "this endpoint requires a signed-in session");
	}
	return user;
}

/**
 * Scopes a bearer credential to a resource and action — an API key's
 * permissions and an agent token's scopes share one vocabulary. Sessions skip
 * this: they already have the owner's full access, and membership / admin
 * checks still apply.
 *
 * Call after `requireUser` / `requireMembership` so an unauthenticated request
 * is still a 401 rather than a 403 about a credential that was never presented.
 */
export function requirePermission(
	locals: App.Locals,
	resource: ApiKeyResource,
	action: ApiKeyAction,
): void {
	if (locals.authVia === "session" || locals.authVia === null) return;
	if (hasPermission(locals.permissions, resource, action)) return;
	error(403, `this credential cannot ${action} ${resource}`);
}
