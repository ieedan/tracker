import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import type { WorkspaceRole } from "@/lib/domain/issues";
import { db } from "./db.server";
import { workspace, workspaceMember } from "./schema.server";

export interface Membership {
	user: App.SessionUser;
	workspace: typeof workspace.$inferSelect;
	role: WorkspaceRole;
}

/** 401s a request with no session and no valid API key. */
export function requireUser(locals: App.Locals): App.SessionUser {
	if (locals.user === null) error(401, "authentication required");
	return locals.user;
}

/**
 * 401s an unauthenticated caller, 404s a workspace they cannot see.
 *
 * A non-member gets 404 rather than 403 on purpose: whether a slug exists is
 * itself information, and there is no reason to leak it.
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

	return { user, workspace: row.workspace, role: row.role };
}

/** Admin-only actions: managing members, invites and workspace settings. */
export function requireAdmin(membership: Membership): Membership {
	if (membership.role !== "admin") error(403, "admin role required");
	return membership;
}

/**
 * Some things a key must not do — notably minting more keys. An API key is a
 * bearer credential, so key management stays on the interactive session.
 */
export function requireInteractiveSession(locals: App.Locals): App.SessionUser {
	const user = requireUser(locals);
	if (locals.authVia === "api-key") {
		error(403, "this endpoint requires a signed-in session, not an API key");
	}
	return user;
}
