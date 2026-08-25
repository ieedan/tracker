import { requireMembership } from "@/lib/server/guards.server";
import { listNotifications } from "@/lib/server/notifications.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { user } = await requireMembership(locals, params.slug);
	return { notifications: await listNotifications(user.id) };
}
