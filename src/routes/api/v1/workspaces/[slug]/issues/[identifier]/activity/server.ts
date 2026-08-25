/**
 * An issue's timeline entries — status moves, reassignments, label changes.
 *
 * Read-only and separate from the comments endpoint: the details view merges
 * the two by timestamp, and an edit made from the rail needs the timeline back
 * without refetching the whole page.
 */
import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { parseIdentifier } from "@/lib/domain/issues";
import { ActivitySchema } from "@/lib/domain/schemas";
import { listActivity } from "@/lib/server/activity.server";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { issue, team } from "@/lib/server/schema.server";
import { handler } from "./$types";

const IdentifierParams = v.object({
	slug: v.string(),
	identifier: v.string(),
});

export const GET = handler({
	params: IdentifierParams,
	response: v.array(ActivitySchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "read");

		const parsed = parseIdentifier(params.identifier);
		if (parsed === null) error(404, `"${params.identifier}" is not an issue identifier`);

		const rows = await db
			.select({ id: issue.id })
			.from(issue)
			.innerJoin(team, eq(team.id, issue.teamId))
			.where(
				and(
					eq(team.workspaceId, workspace.id),
					eq(team.key, parsed.key),
					eq(issue.number, parsed.number),
				),
			)
			.limit(1);

		const found = rows[0];
		if (found === undefined) error(404, `no issue ${parsed.key}-${parsed.number}`);

		return await listActivity(found.id);
	},
});
