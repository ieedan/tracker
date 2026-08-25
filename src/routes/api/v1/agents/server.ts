import * as v from "valibot";
import { ConnectedAgentSchema } from "@/lib/domain/schemas";
import { listConnectedAgents } from "@/lib/server/agents.server";
import { requireUser } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * The agents you have connected.
 *
 * An account-level list, not a workspace one: an agent is authorized once and
 * reaches every workspace you belong to, so "which agents act as me" is a
 * question about you rather than about any one workspace.
 */
export const GET = handler({
	response: v.array(ConnectedAgentSchema),
	async handle({ locals }) {
		const user = requireUser(locals);
		const agents = await listConnectedAgents(user.id);
		return agents.map((agent) => ({
			...agent,
			lastUsedAt: agent.lastUsedAt?.toISOString() ?? null,
			createdAt: agent.createdAt.toISOString(),
		}));
	},
});
