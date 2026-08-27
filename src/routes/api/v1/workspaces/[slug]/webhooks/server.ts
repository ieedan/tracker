import { error } from "@implementjs/kit/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { CreateWebhookBody, WebhookSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import {
	requireAdminAccess,
	requireMembership,
	requirePermission,
} from "@/lib/server/guards.server";
import { webhook } from "@/lib/server/schema.server";
import { toWebhook } from "@/lib/server/serialize.server";
import { assertDeliverableUrl, healthOf, newWebhookSecret } from "@/lib/server/webhooks.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(WebhookSchema),
	async handle({ locals, params }) {
		const membership = requireAdminAccess(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "read");

		const rows = await db
			.select()
			.from(webhook)
			.where(eq(webhook.workspaceId, membership.workspace.id))
			.orderBy(asc(webhook.createdAt));

		const health = await healthOf(rows.map((row) => row.id));
		return rows.map((row) => toWebhook(row, health.get(row.id)));
	},
});

/**
 * Registers an endpoint. The signing secret is returned **once** — it is not
 * readable afterwards, the same as an API key.
 */
export const POST = handler({
	body: CreateWebhookBody,
	response: v.object({ webhook: WebhookSchema, secret: v.string() }),
	async handle({ locals, params, body }) {
		const membership = requireAdminAccess(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "write");

		try {
			// Rejected here rather than at delivery time, so a bad URL is a 400 on
			// the request that set it rather than a silent stream of failures.
			assertDeliverableUrl(body.url, {
				allowLoopback: process.env.NODE_ENV !== "production",
			});
		} catch (cause) {
			error(400, cause instanceof Error ? cause.message : "that URL cannot receive webhooks");
		}

		// The template itself is validated by the schema; what only this pair of
		// fields can say is that the custom format has nothing to render without one.
		if (body.format === "custom" && body.template === null) {
			error(400, "the custom format needs a template");
		}

		const secret = newWebhookSecret();
		const row = {
			id: nanoid(),
			workspaceId: membership.workspace.id,
			url: body.url,
			secret,
			description: body.description,
			events: body.events,
			headers: body.headers,
			filter: body.filter,
			format: body.format,
			template: body.template,
			enabled: true,
			createdBy: membership.user.id,
			createdAt: new Date(),
		};
		await db.insert(webhook).values(row);

		return json({ webhook: toWebhook(row, undefined), secret }, { status: 201 });
	},
});
