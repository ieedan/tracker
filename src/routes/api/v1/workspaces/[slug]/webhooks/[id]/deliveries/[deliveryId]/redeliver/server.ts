import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { WebhookDeliverySchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import {
	requireAdminAccess,
	requireMembership,
	requirePermission,
} from "@/lib/server/guards.server";
import { webhook, webhookDelivery } from "@/lib/server/schema.server";
import { toDelivery } from "@/lib/server/serialize.server";
import { dispatchPending } from "@/lib/server/webhooks.server";
import { handler } from "./$types";

/**
 * Sends a settled delivery again — same id, same signed payload — so a fixed
 * endpoint can be fed the events it missed without waiting for the next one.
 * Awaited, like a test send: the whole point is to see the result.
 */
export const POST = handler({
	response: WebhookDeliverySchema,
	async handle({ locals, params }) {
		const membership = requireAdminAccess(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "write");

		const owned = await db
			.select({ id: webhook.id, enabled: webhook.enabled })
			.from(webhook)
			.where(and(eq(webhook.workspaceId, membership.workspace.id), eq(webhook.id, params.id)))
			.limit(1);
		const hook = owned[0];
		if (hook === undefined) error(404, "no such webhook");
		if (!hook.enabled) error(409, "this webhook is disabled");

		const rows = await db
			.select()
			.from(webhookDelivery)
			.where(
				and(eq(webhookDelivery.id, params.deliveryId), eq(webhookDelivery.webhookId, params.id)),
			)
			.limit(1);
		const delivery = rows[0];
		if (delivery === undefined) error(404, "no such delivery");

		// Re-arm the row rather than clone it: the delivery id is the receiver's
		// idempotency key, and a resend of the same event should carry the same id.
		// A pending row is allowed through — that is a scheduled retry being
		// brought forward, which beats waiting out a two-hour backoff after the
		// endpoint is fixed. If the attempt is abandoned mid-flight, the row is
		// due now and the cron drain picks it up.
		await db
			.update(webhookDelivery)
			.set({ status: "pending", nextAttemptAt: new Date() })
			.where(eq(webhookDelivery.id, delivery.id));
		await dispatchPending([delivery.id]);

		const settled = await db
			.select()
			.from(webhookDelivery)
			.where(eq(webhookDelivery.id, delivery.id))
			.limit(1);
		const after = settled[0];
		if (after === undefined) error(500, "delivery vanished");
		return toDelivery(after);
	},
});
