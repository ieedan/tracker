import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { UpdateWebhookBody, WebhookSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { webhook } from "@/lib/server/schema.server";
import { toWebhook } from "@/lib/server/serialize.server";
import { healthOf } from "@/lib/server/webhooks.server";
import { handler } from "./$types";

export const PATCH = handler({
	body: UpdateWebhookBody,
	response: WebhookSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "write");

		const changes: Partial<typeof webhook.$inferInsert> = {};
		if (body.description !== undefined) changes.description = body.description;
		if (body.events !== undefined) changes.events = body.events;
		if (body.headers !== undefined) changes.headers = body.headers;
		// Explicitly nullable: `null` clears the conditions, absent leaves them.
		if (body.filter !== undefined) changes.filter = body.filter;
		if (body.format !== undefined) changes.format = body.format;
		if (body.template !== undefined) changes.template = body.template;
		if (body.enabled !== undefined) changes.enabled = body.enabled;

		// Format and template are checked as the pair the row will *end up* with,
		// so setting the format in one request and the template in another works —
		// but no sequence of PATCHes leaves a custom webhook with nothing to render.
		if (body.format === "custom" || body.template !== undefined) {
			const existing = await db
				.select({ format: webhook.format, template: webhook.template })
				.from(webhook)
				.where(and(eq(webhook.workspaceId, membership.workspace.id), eq(webhook.id, params.id)))
				.limit(1);
			const current = existing[0];
			if (current === undefined) error(404, "no such webhook");

			const effectiveFormat = body.format ?? current.format;
			const effectiveTemplate = body.template === undefined ? current.template : body.template;
			if (effectiveFormat === "custom" && effectiveTemplate === null) {
				error(400, "the custom format needs a template");
			}
		}

		const updated = await db
			.update(webhook)
			.set(changes)
			.where(and(eq(webhook.workspaceId, membership.workspace.id), eq(webhook.id, params.id)))
			.returning();

		const row = updated[0];
		if (row === undefined) error(404, "no such webhook");

		const health = await healthOf([row.id]);
		return toWebhook(row, health.get(row.id));
	},
});

export const DELETE = handler({
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "webhooks", "write");

		const deleted = await db
			.delete(webhook)
			.where(and(eq(webhook.workspaceId, membership.workspace.id), eq(webhook.id, params.id)))
			.returning({ id: webhook.id });

		if (deleted.length === 0) error(404, "no such webhook");
	},
});
