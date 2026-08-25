import { asc, eq } from "drizzle-orm";
import { requireMembership } from "@/lib/server/guards.server";
import { db } from "@/lib/server/db.server";
import { label, user, workspaceMember } from "@/lib/server/schema.server";
import { toLabel, toMember, toWorkspace } from "@/lib/server/serialize.server";
import { listTeams } from "@/lib/server/teams.server";
import type { LoadEvent } from "./$types";

/**
 * Everything the workspace chrome needs. Members and labels are small, bounded
 * lists that almost every screen under here uses (assignee pickers, label
 * pickers, filters), so they are loaded once for the section.
 */
export default async function load({ locals, params }: LoadEvent) {
	const membership = await requireMembership(locals, params.slug);

	const memberRows = await db
		.select({ member: workspaceMember, user })
		.from(workspaceMember)
		.innerJoin(user, eq(user.id, workspaceMember.userId))
		.where(eq(workspaceMember.workspaceId, membership.workspace.id))
		.orderBy(asc(workspaceMember.createdAt));

	const labelRows = await db
		.select()
		.from(label)
		.where(eq(label.workspaceId, membership.workspace.id))
		.orderBy(asc(label.name));

	return {
		workspace: toWorkspace(membership.workspace, membership.role),
		teams: await listTeams(membership.workspace.id),
		members: memberRows.map((row) => toMember(row.member, row.user)),
		labels: labelRows.map(toLabel),
	};
}
