import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { workspaceMember } from "@/lib/server/schema.server";
import { handler } from "./$types";

export const DELETE = handler({
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "members", "write");

		const admins = await db
			.select({ id: workspaceMember.id })
			.from(workspaceMember)
			.where(
				and(
					eq(workspaceMember.workspaceId, membership.workspace.id),
					eq(workspaceMember.role, "admin"),
				),
			);
		const removingSelf = params.userId === membership.user.id;
		// Never let the last admin out — the workspace would be unmanageable.
		if (removingSelf && admins.length <= 1) {
			error(400, "promote another admin before removing yourself");
		}

		const removed = await db
			.delete(workspaceMember)
			.where(
				and(
					eq(workspaceMember.workspaceId, membership.workspace.id),
					eq(workspaceMember.userId, params.userId),
				),
			)
			.returning({ id: workspaceMember.id });
		if (removed.length === 0) error(404, "not a member of this workspace");
	},
});
