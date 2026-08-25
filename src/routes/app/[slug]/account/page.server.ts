import { requireMembership } from "@/lib/server/guards.server";
import type { LoadEvent } from "./$types";

/**
 * Account settings, as opposed to workspace settings.
 *
 * Agents live here because a grant is not scoped to a workspace: you authorize
 * one once and it acts as you everywhere you are a member. Filing it under a
 * workspace would say the opposite.
 *
 * The slug in the URL only picks which workspace's shell to render around it —
 * nothing on this page belongs to that workspace, which is why the load only
 * checks that you can see it.
 */
export default async function load({ locals, params }: LoadEvent) {
	const { user } = await requireMembership(locals, params.slug);
	return { user };
}
