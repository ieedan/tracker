import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { TeamSchema } from "@/lib/domain/schemas";
import { TeamColorSchema, TeamIconNameSchema } from "@/lib/domain/team-icons";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { team } from "@/lib/server/schema.server";
import { toTeam } from "@/lib/server/serialize.server";
import { countTeamIssues, requireTeam } from "@/lib/server/teams.server";
import { handler } from "./$types";

/** Teams are addressed by the key people already say — `ENG`, not an id. */
const TeamParams = v.object({
	slug: v.string(),
	key: v.string(),
});

/**
 * The key is deliberately not editable: it is baked into every identifier the
 * team has ever issued, so changing it would rewrite history rather than rename
 * a thing. `null` on either half of the tile clears it back to the fallback.
 */
const UpdateTeamBody = v.object({
	name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60))),
	icon: v.optional(v.nullable(TeamIconNameSchema)),
	color: v.optional(v.nullable(TeamColorSchema)),
});

export const GET = handler({
	params: TeamParams,
	response: TeamSchema,
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "read");

		const found = await requireTeam(workspace.id, params.key);
		return toTeam(found, await countTeamIssues(found.id));
	},
});

export const PATCH = handler({
	params: TeamParams,
	body: UpdateTeamBody,
	response: TeamSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		const found = await requireTeam(membership.workspace.id, params.key);

		// Absent leaves a field alone, `null` clears it — the same three-way check
		// the workspace patch makes for its picture.
		const patch = {
			...(body.name === undefined ? {} : { name: body.name }),
			...(body.icon === undefined ? {} : { icon: body.icon }),
			...(body.color === undefined ? {} : { color: body.color }),
		};
		if (Object.keys(patch).length === 0) error(400, "nothing to update");

		await db.update(team).set(patch).where(eq(team.id, found.id));

		return toTeam({ ...found, ...patch }, await countTeamIssues(found.id));
	},
});
