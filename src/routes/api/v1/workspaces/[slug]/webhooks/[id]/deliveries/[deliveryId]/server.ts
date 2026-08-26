import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { WebhookDeliveryDetailSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { webhook, webhookDelivery } from "@/lib/server/schema.server";
import { toDeliveryDetail } from "@/lib/server/serialize.server";
import { requestHeadersFor } from "@/lib/server/webhooks.server";
import { handler } from "./$types";

/**
 * One delivery in full — the payload that was sent, the headers it went out
 * with, and what the endpoint said back. This is the "why did it 400" view;
 * the list above it only says that it did.
 */
export const GET = handler({
	response: WebhookDeliveryDetailSchema,
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "read");

		const rows = await db
			.select({ delivery: webhookDelivery, hook: webhook })
			.from(webhookDelivery)
			.innerJoin(webhook, eq(webhook.id, webhookDelivery.webhookId))
			.where(
				and(
					eq(webhook.workspaceId, membership.workspace.id),
					eq(webhook.id, params.id),
					eq(webhookDelivery.id, params.deliveryId),
				),
			)
			.limit(1);
		const row = rows[0];
		if (row === undefined) error(404, "no such delivery");

		return toDeliveryDetail(
			row.delivery,
			requestHeadersFor(row.hook, row.delivery, row.delivery.deliveredAt ?? row.delivery.createdAt),
		);
	},
});
