import { redirect } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { unreadCount } from "@/lib/server/notifications.server";
import { workspace, workspaceMember } from "@/lib/server/schema.server";
import { toWorkspace, userImageUrl } from "@/lib/server/serialize.server";
import type { LayoutLoadEvent } from "./$types";

/**
 * The shell's data: who you are, which workspaces you can switch to, and how
 * many notifications are waiting. Every page under /app reads this.
 */
export default async function load({ locals }: LayoutLoadEvent) {
	// hooks.server.ts already redirects an anonymous visitor; this narrows the type.
	if (locals.user === null) redirect(303, "/login");

	const rows = await db
		.select({ workspace, role: workspaceMember.role })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(eq(workspaceMember.userId, locals.user.id))
		.orderBy(workspace.createdAt);

	// Nothing under /app can render without a workspace — the sidebar would link
	// into routes that 404, which is exactly what used to happen. Send anyone
	// without one to create one instead.
	if (rows.length === 0) redirect(303, "/workspaces/new");

	return {
		// `locals.user` carries the picture column as it is stored, which for one
		// uploaded here is an object key rather than something an `<img>` can load.
		user: { ...locals.user, image: userImageUrl(locals.user.id, locals.user.image) },
		workspaces: rows.map((row) => toWorkspace(row.workspace, row.role)),
		unread: await unreadCount(locals.user.id),
	};
}
