import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { WebhookDeliveryDetailSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { webhook, webhookDelivery } from "@/lib/server/schema.server";
import { toDeliveryDetail } from "@/lib/server/serialize.server";
import { handler } from "./$types";

/**
 * One delivery in full — the payload that was sent and what the endpoint said
 * back. This is the "why did it 400" view; the list above it only says that it
 * did.
 */
export const GET = handler({
	response: WebhookDeliveryDetailSchema,
	async handle({ locals, params }) {
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
			.where(
				and(eq(webhookDelivery.id, params.deliveryId), eq(webhookDelivery.webhookId, params.id)),
			)
			.limit(1);
		const delivery = rows[0];
		if (delivery === undefined) error(404, "no such delivery");

		return toDeliveryDetail(delivery);
	},
});
