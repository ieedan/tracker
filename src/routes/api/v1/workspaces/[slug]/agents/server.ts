import * as v from "valibot";
import { InstalledAgentSchema } from "@/lib/domain/schemas";
import { listInstalledAgents } from "@/lib/server/agents.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * The agents authorized into this workspace.
 *
 * Scoped to `members` rather than a scope of its own: who can act in the
 * workspace is the same question the members list answers, and a bot is a
 * member.
 */
export const GET = handler({
	response: v.array(InstalledAgentSchema),
	async handle({ locals, params }) {
		const membership = await requireMembership(locals, params.slug);
		requirePermission(locals, "members", "read");

		const agents = await listInstalledAgents(membership.workspace.id);
		return agents.map((agent) => ({
			...agent,
			lastUsedAt: agent.lastUsedAt?.toISOString() ?? null,
			createdAt: agent.createdAt.toISOString(),
		}));
	},
});
