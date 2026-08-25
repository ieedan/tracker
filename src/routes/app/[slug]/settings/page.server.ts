import { requireMembership } from "@/lib/server/guards.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	// Members and labels come from the section layout; this page only adds who
	// is looking, so the member list can mark their own row. API keys are
	// fetched in the browser so the plaintext of a freshly minted key never
	// lands in a server-rendered payload.
	const membership = await requireMembership(locals, params.slug);
	return { viewerId: membership.user.id };
}
