import { requireMembership } from "@/lib/server/guards.server";
import { listIssues } from "@/lib/server/issues.server";
import { requireTeam } from "@/lib/server/teams.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);
	const team = await requireTeam(workspace.id, params.key);

	return {
		issues: await listIssues(workspace.id, { teamKey: team.key }),
		team: { id: team.id, name: team.name, key: team.key },
	};
}
