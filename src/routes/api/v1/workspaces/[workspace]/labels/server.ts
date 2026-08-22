import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, parseBody } from "@/lib/server/api.server";
import { db, schema } from "@/lib/server/db/index.server";
import { labelDto } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const rows = await db
		.select()
		.from(schema.label)
		.where(eq(schema.label.workspaceId, workspace.id))
		.orderBy(asc(schema.label.name));

	return json({ items: rows.map(labelDto) });
}

const createBody = z.object({
	name: z.string().min(1).max(64),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	description: z.string().max(512).nullable().optional(),
});

export async function POST({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const body = await parseBody(request, createBody);

	const [row] = await db
		.insert(schema.label)
		.values({ ...body, description: body.description ?? null, workspaceId: workspace.id })
		.returning();

	return json(labelDto(row!), { status: 201 });
}
