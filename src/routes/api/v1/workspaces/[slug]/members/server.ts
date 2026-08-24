import { error } from "@implementjs/kit/server";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { AddMemberBody, MemberSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership } from "@/lib/server/guards.server";
import { user, workspaceMember } from "@/lib/server/schema.server";
import { toMember } from "@/lib/server/serialize.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(MemberSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		const rows = await db
			.select({ member: workspaceMember, user })
			.from(workspaceMember)
			.innerJoin(user, eq(user.id, workspaceMember.userId))
			.where(eq(workspaceMember.workspaceId, workspace.id))
			.orderBy(asc(workspaceMember.createdAt));
		return rows.map((row) => toMember(row.member, row.user));
	},
});

/**
 * Add someone who already has an account, by email.
 *
 * There is no mail delivery here, so this is the direct half of inviting; the
 * shareable link in `/invites` is the other.
 */
export const POST = handler({
	body: AddMemberBody,
	response: MemberSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));

		const found = await db
			.select()
			.from(user)
			.where(eq(user.email, body.email.toLowerCase()))
			.limit(1);
		const target = found[0];
		if (target === undefined) {
			error(404, `no account for ${body.email} — send them an invite link instead`);
		}

		const existing = await db
			.select({ id: workspaceMember.id })
			.from(workspaceMember)
			.where(
				and(
					eq(workspaceMember.workspaceId, membership.workspace.id),
					eq(workspaceMember.userId, target.id),
				),
			)
			.limit(1);
		if (existing.length > 0) error(409, "already a member of this workspace");

		const row = {
			id: nanoid(),
			workspaceId: membership.workspace.id,
			userId: target.id,
			role: body.role,
			createdAt: new Date(),
		};
		await db.insert(workspaceMember).values(row);
		return json(toMember(row, target), { status: 201 });
	},
});
