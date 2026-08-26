import { requireMembership } from "@/lib/server/guards.server";
import { userImageUrl } from "@/lib/server/serialize.server";
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
	// The picture column as stored is an object key for one uploaded here, so it
	// goes out as the URL that serves it — same as every other user the API returns.
	return { user: { ...user, image: userImageUrl(user.id, user.image) } };
}
