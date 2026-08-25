import { error } from "@implementjs/kit/server";
import { and, eq, inArray } from "drizzle-orm";
import { MemberSchema, UpdateMemberBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { issue, team, user, workspaceMember } from "@/lib/server/schema.server";
import { toMember } from "@/lib/server/serialize.server";
import { handler } from "./$types";

export const PATCH = handler({
	body: UpdateMemberBody,
	response: MemberSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "members", "write");

		const target = await findMember(membership.workspace.id, params.userId);

		// A bot is admitted through the person who authorized it and capped at
		// `member` by `requireMembership`, so writing `admin` onto its row would
		// only be a promise the guards never keep.
		if (target.user.type === "agent") {
			error(400, "an agent always acts as a member — its access follows whoever connected it");
		}

		if (target.member.role !== body.role) {
			// Never let the last admin go — the workspace would be unmanageable.
			if (target.member.role === "admin" && (await countAdmins(membership.workspace.id)) <= 1) {
				error(
					400,
					params.userId === membership.user.id
						? "promote another admin before stepping down"
						: "this is the only admin — promote someone else first",
				);
			}
			await db
				.update(workspaceMember)
				.set({ role: body.role })
				.where(eq(workspaceMember.id, target.member.id));
		}

		return toMember({ ...target.member, role: body.role }, target.user);
	},
});

export const DELETE = handler({
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "members", "write");

		const target = await findMember(membership.workspace.id, params.userId);

		// Never let the last admin out — the workspace would be unmanageable.
		if (target.member.role === "admin" && (await countAdmins(membership.workspace.id)) <= 1) {
			error(
				400,
				params.userId === membership.user.id
					? "promote another admin before removing yourself"
					: "this is the only admin — promote someone else first",
			);
		}

		await db.delete(workspaceMember).where(eq(workspaceMember.id, target.member.id));

		// Assignments outlive the membership otherwise: `issue.assigneeId` points
		// at the user, not the member row, so an ex-member would keep showing up
		// as the owner of work they can no longer see.
		await db
			.update(issue)
			.set({ assigneeId: null, updatedAt: new Date() })
			.where(
				and(
					eq(issue.assigneeId, params.userId),
					inArray(
						issue.teamId,
						db
							.select({ id: team.id })
							.from(team)
							.where(eq(team.workspaceId, membership.workspace.id)),
					),
				),
			);
	},
});

/** The member row plus the person behind it, or a 404 that says so. */
async function findMember(workspaceId: string, userId: string) {
	const rows = await db
		.select({ member: workspaceMember, user })
		.from(workspaceMember)
		.innerJoin(user, eq(user.id, workspaceMember.userId))
		.where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, "not a member of this workspace");
	return row;
}

async function countAdmins(workspaceId: string): Promise<number> {
	const rows = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "admin")));
	return rows.length;
}
