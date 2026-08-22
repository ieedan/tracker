import { redirect } from "@implementjs/kit/server";
import { callerOf } from "@/lib/server/access.server";
import { listForUser } from "@/lib/server/workspaces.server";
import type { LoadEvent } from "./$types";

/**
 * The root is a signpost, never a page: it sends you to your first workspace,
 * to sign-in, or to the empty state explaining that GitHub has no owners to
 * make a workspace out of.
 */
export default async function load({ locals }: LoadEvent) {
	const caller = callerOf(locals);
	if (caller === null) redirect(303, "/login");

	const workspaces = await listForUser(caller.id);
	if (workspaces.length > 0) redirect(303, `/${workspaces[0]!.slug}`);

	return {};
}
