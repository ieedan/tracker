import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { CreateInviteBody, WorkspaceRoleSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership } from "@/lib/server/guards.server";
import { workspaceInvite } from "@/lib/server/schema.server";
import { handler, json } from "./$types";

const InviteSchema = v.object({
	id: v.string(),
	token: v.string(),
	role: WorkspaceRoleSchema,
	/** Ready to paste into a chat. */
	url: v.string(),
	expiresAt: v.nullable(v.string()),
	revoked: v.boolean(),
	createdAt: v.string(),
});

export const GET = handler({
	response: v.array(InviteSchema),
	async handle({ locals, params, url }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		const rows = await db
			.select()
			.from(workspaceInvite)
			.where(eq(workspaceInvite.workspaceId, membership.workspace.id))
			.orderBy(desc(workspaceInvite.createdAt));

		return rows.map((row) => ({
			id: row.id,
			token: row.token,
			role: row.role,
			url: new URL(`/invite/${row.token}`, url.origin).toString(),
			expiresAt: row.expiresAt?.toISOString() ?? null,
			revoked: row.revokedAt !== null,
			createdAt: row.createdAt.toISOString(),
		}));
	},
});

export const POST = handler({
	body: CreateInviteBody,
	response: InviteSchema,
	async handle({ locals, params, body, url }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));

		const row = {
			id: nanoid(),
			workspaceId: membership.workspace.id,
			token: nanoid(24),
			role: body.role,
			createdBy: membership.user.id,
			expiresAt:
				body.expiresInHours === undefined
					? null
					: new Date(Date.now() + body.expiresInHours * 3600_000),
			revokedAt: null,
			createdAt: new Date(),
		};
		await db.insert(workspaceInvite).values(row);

		return json(
			{
				id: row.id,
				token: row.token,
				role: row.role,
				url: new URL(`/invite/${row.token}`, url.origin).toString(),
				expiresAt: row.expiresAt?.toISOString() ?? null,
				revoked: false,
				createdAt: row.createdAt.toISOString(),
			},
			{ status: 201 },
		);
	},
});
