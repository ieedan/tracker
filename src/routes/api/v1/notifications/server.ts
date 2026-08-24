import * as v from "valibot";
import { MarkNotificationsBody, NotificationSchema } from "@/lib/domain/schemas";
import { requireUser } from "@/lib/server/guards.server";
import { listNotifications, markRead } from "@/lib/server/notifications.server";
import { handler } from "./$types";

export const GET = handler({
	query: v.object({
		unread: v.optional(
			v.pipe(
				v.string(),
				v.transform((value) => value === "true"),
			),
		),
	}),
	response: v.array(NotificationSchema),
	async handle({ locals, query }) {
		const user = requireUser(locals);
		return await listNotifications(user.id, { unreadOnly: query.unread === true });
	},
});

/** Mark the listed notifications read, or the whole inbox when `ids` is omitted. */
export const POST = handler({
	body: MarkNotificationsBody,
	response: v.object({ ok: v.boolean() }),
	async handle({ locals, body }) {
		const user = requireUser(locals);
		await markRead(user.id, body.ids);
		return { ok: true };
	},
});
