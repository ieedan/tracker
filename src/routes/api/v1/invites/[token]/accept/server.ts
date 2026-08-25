import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { WorkspaceSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireUser, requirePermission } from "@/lib/server/guards.server";
import { workspace, workspaceInvite, workspaceMember } from "@/lib/server/schema.server";
import { toWorkspace } from "@/lib/server/serialize.server";
import { handler } from "./$types";

export const POST = handler({
	response: WorkspaceSchema,
	async handle({ locals, params }) {
		const user = requireUser(locals);
		requirePermission(locals, "members", "write");

		const rows = await db
			.select({ invite: workspaceInvite, workspace })
			.from(workspaceInvite)
			.innerJoin(workspace, eq(workspace.id, workspaceInvite.workspaceId))
			.where(eq(workspaceInvite.token, params.token))
			.limit(1);

		const row = rows[0];
		if (row === undefined) error(404, "invite not found");
		if (row.invite.revokedAt !== null) error(410, "this invite has been revoked");
		if (row.invite.expiresAt !== null && row.invite.expiresAt.getTime() < Date.now()) {
			error(410, "this invite has expired");
		}

		const existing = await db
			.select({ role: workspaceMember.role })
			.from(workspaceMember)
			.where(
				and(eq(workspaceMember.workspaceId, row.workspace.id), eq(workspaceMember.userId, user.id)),
			)
			.limit(1);

		// Following the same link twice is not an error — you are simply already in.
		const already = existing[0];
		if (already !== undefined) return toWorkspace(row.workspace, already.role);

		await db.insert(workspaceMember).values({
			id: nanoid(),
			workspaceId: row.workspace.id,
			userId: user.id,
			role: row.invite.role,
			createdAt: new Date(),
		});

		return toWorkspace(row.workspace, row.invite.role);
	},
});
