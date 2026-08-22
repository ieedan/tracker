import { and, eq } from "drizzle-orm";
import { error } from "@implementjs/kit/server";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, noContent, parseBody } from "@/lib/server/api.server";
import { db, schema } from "@/lib/server/db/index.server";
import { labelDto } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

const patchBody = z.object({
	name: z.string().min(1).max(64).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
	description: z.string().max(512).nullable().optional(),
});

export async function PATCH({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const [row] = await db
		.update(schema.label)
		.set(await parseBody(request, patchBody))
		.where(and(eq(schema.label.id, params.labelId), eq(schema.label.workspaceId, workspace.id)))
		.returning();

	if (row === undefined) error(404, "No such label");
	return json(labelDto(row));
}

export async function DELETE({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const deleted = await db
		.delete(schema.label)
		.where(and(eq(schema.label.id, params.labelId), eq(schema.label.workspaceId, workspace.id)))
		.returning({ id: schema.label.id });

	if (deleted.length === 0) error(404, "No such label");
	return noContent();
}
