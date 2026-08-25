import * as v from "valibot";
import { WorkspaceAgentSchema } from "@/lib/domain/schemas";
import { listWorkspaceAgents } from "@/lib/server/agents.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * The agents that can act in this workspace, and who they act for.
 *
 * Derived from members' grants rather than stored: an agent reaches a workspace
 * through a person, so this changes the moment they revoke or leave. Read-only
 * for that reason — there is nothing here to revoke that is not someone else's
 * to disconnect.
 */
export const GET = handler({
	response: v.array(WorkspaceAgentSchema),
	async handle({ locals, params }) {
		const membership = await requireMembership(locals, params.slug);
		requirePermission(locals, "members", "read");
		return await listWorkspaceAgents(membership.workspace.id);
	},
});
