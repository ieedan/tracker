import { requireMembership } from "@/lib/server/guards.server";
import { listFeedback } from "@/lib/server/feedback.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);
	return { feedback: await listFeedback(workspace.id, { audience: "member" }) };
}
