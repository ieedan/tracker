import { eq } from "drizzle-orm";
import * as v from "valibot";
import { WorkspaceSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership } from "@/lib/server/guards.server";
import { workspace } from "@/lib/server/schema.server";
import { toWorkspace } from "@/lib/server/serialize.server";
import { handler } from "./$types";

export const GET = handler({
	response: WorkspaceSchema,
	async handle({ locals, params }) {
		const membership = await requireMembership(locals, params.slug);
		return toWorkspace(membership.workspace, membership.role);
	},
});

export const PATCH = handler({
	body: v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)) }),
	response: WorkspaceSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		await db
			.update(workspace)
			.set({ name: body.name, updatedAt: new Date() })
			.where(eq(workspace.id, membership.workspace.id));
		return toWorkspace({ ...membership.workspace, name: body.name }, membership.role);
	},
});
