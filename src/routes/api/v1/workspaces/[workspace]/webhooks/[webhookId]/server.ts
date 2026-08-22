import { and, eq } from "drizzle-orm";
import { error } from "@implementjs/kit/server";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, noContent, parseBody } from "@/lib/server/api.server";
import { WEBHOOK_EVENTS } from "@/lib/types";
import { db, schema } from "@/lib/server/db/index.server";
import type { RequestEvent } from "./$types";

const patchBody = z.object({
	url: z.url().optional(),
	events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
	enabled: z.boolean().optional(),
});

export async function PATCH({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const [row] = await db
		.update(schema.webhook)
		.set(await parseBody(request, patchBody))
		.where(
			and(eq(schema.webhook.id, params.webhookId), eq(schema.webhook.workspaceId, workspace.id)),
		)
		.returning();

	if (row === undefined) error(404, "No such webhook");
	return json({
		id: row.id,
		url: row.url,
		events: row.events,
		enabled: row.enabled,
		lastStatus: row.lastStatus,
		lastError: row.lastError,
		lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
	});
}

export async function DELETE({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const deleted = await db
		.delete(schema.webhook)
		.where(
			and(eq(schema.webhook.id, params.webhookId), eq(schema.webhook.workspaceId, workspace.id)),
		)
		.returning({ id: schema.webhook.id });

	if (deleted.length === 0) error(404, "No such webhook");
	return noContent();
}
