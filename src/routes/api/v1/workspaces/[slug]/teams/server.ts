import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { CreateTeamBody, TeamSchema } from "@/lib/domain/schemas";
import { TeamColorSchema, TeamIconNameSchema } from "@/lib/domain/team-icons";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { team } from "@/lib/server/schema.server";
import { toTeam } from "@/lib/server/serialize.server";
import {
	assertValidTeamKey,
	listTeams,
	teamKeyFrom,
	uniqueTeamKey,
} from "@/lib/server/teams.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(TeamSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "read");
		return await listTeams(workspace.id);
	},
});

/**
 * The tile is optional on create — a team with neither gets the hashed fallback
 * — so it rides along with the shared create body rather than forking it. The
 * names are validated against `TEAM_ICON_NAMES`, which is also what the picker
 * renders from, so nothing the UI can offer is refused here.
 */
const CreateTeamWithTile = v.object({
	...CreateTeamBody.entries,
	icon: v.optional(v.nullable(TeamIconNameSchema)),
	color: v.optional(v.nullable(TeamColorSchema)),
});

export const POST = handler({
	body: CreateTeamWithTile,
	response: TeamSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		const requested = body.key === undefined || body.key === "" ? teamKeyFrom(body.name) : body.key;
		const key = assertValidTeamKey(requested);

		// An explicit key that collides is an error worth reporting; a derived one
		// is a guess, so it gets a suffix instead.
		const existing = await db
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.workspaceId, membership.workspace.id), eq(team.key, key)))
			.limit(1);

		let finalKey = key;
		if (existing.length > 0) {
			if (body.key !== undefined && body.key !== "") {
				return json({ message: `team key ${key} is already taken` }, { status: 409 });
			}
			finalKey = await uniqueTeamKey(membership.workspace.id, key);
		}

		const row = {
			id: nanoid(),
			workspaceId: membership.workspace.id,
			name: body.name,
			key: finalKey,
			icon: body.icon ?? null,
			color: body.color ?? null,
			createdAt: new Date(),
		};
		await db.insert(team).values(row);

		return json(toTeam(row, 0), { status: 201 });
	},
});
