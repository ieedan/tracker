import { error } from "@implementjs/kit/server";
import * as v from "valibot";
import { revokeAgentGrant } from "@/lib/server/agents.server";
import {
	requireAdmin,
	requireInteractiveSession,
	requireMembership,
} from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * Revokes one agent's grant.
 *
 * Admin-only and session-only: revoking is a change to who may act in the
 * workspace, and an agent must not be able to revoke a peer — or itself back
 * out of a restriction.
 *
 * The bot member survives. Its name is on comments and issues that should keep
 * rendering; it simply has no live grant, so nothing can act as it.
 */
export const DELETE = handler({
	response: v.object({ ok: v.literal(true) }),
	async handle({ locals, params }) {
		requireInteractiveSession(locals);
		const membership = requireAdmin(await requireMembership(locals, params.slug));

		const revoked = await revokeAgentGrant(membership.workspace.id, params.grantId);
		if (!revoked) error(404, "no such agent");

		return { ok: true as const };
	},
});
