import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, parseBody } from "@/lib/server/api.server";
import { WEBHOOK_EVENTS, type WebhookDto } from "@/lib/types";
import { db, schema } from "@/lib/server/db/index.server";
import { generateSecret } from "@/lib/server/webhooks.server";
import type { RequestEvent } from "./$types";

function toDto(row: typeof schema.webhook.$inferSelect): WebhookDto {
	return {
		id: row.id,
		url: row.url,
		events: row.events,
		enabled: row.enabled,
		lastStatus: row.lastStatus,
		lastError: row.lastError,
		lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
	};
}

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const rows = await db
		.select()
		.from(schema.webhook)
		.where(eq(schema.webhook.workspaceId, workspace.id))
		.orderBy(asc(schema.webhook.createdAt));

	return json({ items: rows.map(toDto) });
}

const createBody = z.object({
	// http is allowed so a local receiver can be pointed at during development.
	url: z.url().refine((value) => value.startsWith("http"), "Must be an http(s) URL"),
	events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export async function POST({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const body = await parseBody(request, createBody);

	const secret = generateSecret();
	const [row] = await db
		.insert(schema.webhook)
		.values({ workspaceId: workspace.id, url: body.url, events: body.events, secret })
		.returning();

	// The only time the secret is ever returned — it is not readable again.
	return json({ ...toDto(row!), secret }, { status: 201 });
}
