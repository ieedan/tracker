import { and, count, eq } from "drizzle-orm";
import { error } from "@implementjs/kit/server";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, noContent, parseBody } from "@/lib/server/api.server";
import { db, schema } from "@/lib/server/db/index.server";
import type { RequestEvent } from "./$types";

const patchBody = z.object({
	name: z.string().min(1).max(64).optional(),
	category: z.enum(["backlog", "unstarted", "started", "completed", "canceled"]).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
	position: z.number().int().min(0).optional(),
});

export async function PATCH({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const body = await parseBody(request, patchBody);

	const [row] = await db
		.update(schema.status)
		.set(body)
		.where(
			and(eq(schema.status.id, params.statusId), eq(schema.status.workspaceId, workspace.id)),
		)
		.returning();

	if (row === undefined) error(404, "No such status");
	return json({
		id: row.id,
		name: row.name,
		category: row.category,
		color: row.color,
		position: row.position,
	});
}

/**
 * Archived rather than deleted. `issue.statusId` is `restrict`, so removing a
 * status that issues still point at would fail at the database — and silently
 * moving those issues somewhere else is not a decision this endpoint should make.
 */
export async function DELETE({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const [inUse] = await db
		.select({ total: count() })
		.from(schema.issue)
		.where(eq(schema.issue.statusId, params.statusId));

	if (Number(inUse?.total ?? 0) > 0) {
		const [row] = await db
			.update(schema.status)
			.set({ archivedAt: new Date() })
			.where(
				and(eq(schema.status.id, params.statusId), eq(schema.status.workspaceId, workspace.id)),
			)
			.returning();
		if (row === undefined) error(404, "No such status");
		return noContent();
	}

	const deleted = await db
		.delete(schema.status)
		.where(and(eq(schema.status.id, params.statusId), eq(schema.status.workspaceId, workspace.id)))
		.returning({ id: schema.status.id });

	if (deleted.length === 0) error(404, "No such status");
	return noContent();
}
