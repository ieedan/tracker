import * as v from "valibot";
import { requireUser } from "@/lib/server/guards.server";
import { unreadCount } from "@/lib/server/notifications.server";
import { handler } from "./$types";

/** What the inbox badge polls. */
export const GET = handler({
	response: v.object({ count: v.number() }),
	async handle({ locals }) {
		const user = requireUser(locals);
		return { count: await unreadCount(user.id) };
	},
});
