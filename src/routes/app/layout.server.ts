import { redirect } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { unreadCount } from "@/lib/server/notifications.server";
import { workspace, workspaceMember } from "@/lib/server/schema.server";
import { toWorkspace } from "@/lib/server/serialize.server";
import type { LoadEvent } from "./$types";

/**
 * The shell's data: who you are, which workspaces you can switch to, and how
 * many notifications are waiting. Every page under /app reads this.
 */
export default async function load({ locals }: LoadEvent) {
	// hooks.server.ts already redirects an anonymous visitor; this narrows the type.
	if (locals.user === null) redirect(303, "/login");

	const rows = await db
		.select({ workspace, role: workspaceMember.role })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(eq(workspaceMember.userId, locals.user.id))
		.orderBy(workspace.createdAt);

	return {
		user: locals.user,
		workspaces: rows.map((row) => toWorkspace(row.workspace, row.role)),
		unread: await unreadCount(locals.user.id),
	};
}
