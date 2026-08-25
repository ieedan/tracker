import { requireMembership } from "@/lib/server/guards.server";
import { listIssues } from "@/lib/server/issues.server";
import { listRepositories } from "@/lib/server/repositories.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);
	// Every team's issues; the team badge on each row says which.
	return {
		issues: await listIssues(workspace.id),
		team: null,
		// The bulk actions can scope a selection to a repository.
		repositories: await listRepositories(workspace.id),
	};
}
