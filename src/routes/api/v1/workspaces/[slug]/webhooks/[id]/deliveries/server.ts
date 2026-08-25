import { error } from "@implementjs/kit/server";
import { and, desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { WebhookDeliverySchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { webhook, webhookDelivery } from "@/lib/server/schema.server";
import { toDelivery } from "@/lib/server/serialize.server";
import { handler } from "./$types";

/** The delivery log, newest first — where you look when an integration is quiet. */
export const GET = handler({
	query: v.object({
		limit: v.optional(
			v.pipe(
				v.string(),
				v.transform(Number),
				v.number(),
				v.integer(),
				v.minValue(1),
				v.maxValue(100),
			),
			"25",
		),
	}),
	response: v.array(WebhookDeliverySchema),
	async handle({ locals, params, query }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "read");

		const owned = await db
			.select({ id: webhook.id })
			.from(webhook)
			.where(and(eq(webhook.workspaceId, membership.workspace.id), eq(webhook.id, params.id)))
			.limit(1);
		if (owned.length === 0) error(404, "no such webhook");

		const rows = await db
			.select()
			.from(webhookDelivery)
			.where(eq(webhookDelivery.webhookId, params.id))
			.orderBy(desc(webhookDelivery.createdAt))
			.limit(query.limit);

		return rows.map(toDelivery);
	},
});
