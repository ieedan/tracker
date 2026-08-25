import * as v from "valibot";
import {
	MarkNotificationsBody,
	NotificationOrderSchema,
	NotificationSchema,
} from "@/lib/domain/schemas";
import { requirePermission, requireUser } from "@/lib/server/guards.server";
import { listNotifications, setRead } from "@/lib/server/notifications.server";
import { handler } from "./$types";

export const GET = handler({
	query: v.object({
		unread: v.optional(
			v.pipe(
				v.string(),
				v.transform((value) => value === "true"),
			),
		),
		/** `oldest` walks the inbox from the bottom up. */
		order: v.optional(NotificationOrderSchema),
	}),
	response: v.array(NotificationSchema),
	async handle({ locals, query }) {
		const user = requireUser(locals);
		requirePermission(locals, "notifications", "read");
		return await listNotifications(user.id, {
			unreadOnly: query.unread === true,
			order: query.order,
		});
	},
});

/**
 * Mark the listed notifications read — or unread with `read: false` — falling
 * back to the whole inbox when `ids` is omitted.
 */
export const POST = handler({
	body: MarkNotificationsBody,
	response: v.object({ ok: v.boolean() }),
	async handle({ locals, body }) {
		const user = requireUser(locals);
		requirePermission(locals, "notifications", "write");
		await setRead(user.id, body.ids, body.read ?? true);
		return { ok: true };
	},
});
