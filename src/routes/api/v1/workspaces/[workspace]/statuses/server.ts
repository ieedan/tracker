import { and, asc, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, parseBody } from "@/lib/server/api.server";
import { db, schema } from "@/lib/server/db/index.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const rows = await db
		.select()
		.from(schema.status)
		.where(and(eq(schema.status.workspaceId, workspace.id), isNull(schema.status.archivedAt)))
		.orderBy(asc(schema.status.position));

	return json({
		items: rows.map((row) => ({
			id: row.id,
			name: row.name,
			category: row.category,
			color: row.color,
			position: row.position,
		})),
	});
}

const createBody = z.object({
	name: z.string().min(1).max(64),
	category: z.enum(["backlog", "unstarted", "started", "completed", "canceled"]),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function POST({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const body = await parseBody(request, createBody);

	const [last] = await db
		.select({ highest: max(schema.status.position) })
		.from(schema.status)
		.where(eq(schema.status.workspaceId, workspace.id));

	const [row] = await db
		.insert(schema.status)
		.values({ ...body, workspaceId: workspace.id, position: (last?.highest ?? -1) + 1 })
		.returning();

	return json(
		{ id: row!.id, name: row!.name, category: row!.category, color: row!.color, position: row!.position },
		{ status: 201 },
	);
}
