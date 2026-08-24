import { requireMembership } from "@/lib/server/guards.server";
import { listIssues } from "@/lib/server/issues.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);
	return { issues: await listIssues(workspace.id, workspace.key) };
}
