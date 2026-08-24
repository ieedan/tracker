import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { WebhookDeliverySchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership } from "@/lib/server/guards.server";
import { webhook, webhookDelivery } from "@/lib/server/schema.server";
import { toDelivery } from "@/lib/server/serialize.server";
import { dispatchPending, enqueue } from "@/lib/server/webhooks.server";
import { handler } from "./$types";

/**
 * Sends a real, signed delivery so the receiving end can be checked without
 * waiting for someone to file an issue. Awaited rather than opportunistic —
 * the whole point is to see the result.
 */
export const POST = handler({
	response: WebhookDeliverySchema,
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));

		const rows = await db
			.select()
			.from(webhook)
			.where(and(eq(webhook.workspaceId, membership.workspace.id), eq(webhook.id, params.id)))
			.limit(1);
		const hook = rows[0];
		if (hook === undefined) error(404, "no such webhook");

		// A test uses whichever event the hook actually listens for, so a receiver
		// that switches on the event name still recognises it.
		const event = hook.events[0] ?? "issue.created";
		const ids = await enqueue(
			{
				event,
				workspace: {
					id: membership.workspace.id,
					slug: membership.workspace.slug,
					name: membership.workspace.name,
				},
				actor: {
					id: membership.user.id,
					name: membership.user.name,
					email: membership.user.email,
				},
				data: { test: true, message: "This is a test delivery from tracker." },
			},
			{ webhookId: hook.id },
		);

		const id = ids[0];
		if (id === undefined) error(409, "this webhook is disabled or listens for no events");

		await dispatchPending([id]);

		const settled = await db
			.select()
			.from(webhookDelivery)
			.where(eq(webhookDelivery.id, id))
			.limit(1);
		const delivery = settled[0];
		if (delivery === undefined) error(500, "delivery vanished");
		return toDelivery(delivery);
	},
});
