import { error } from "@implementjs/kit/server";
import * as v from "valibot";
import { revokeAgentGrant } from "@/lib/server/agents.server";
import { requireInteractiveSession } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * Disconnects one agent install.
 *
 * Yours to revoke, and only yours: a grant is your delegation, so it is keyed
 * to you rather than to a workspace admin. Revoking cuts that install off
 * everywhere at once, which is the flip side of authorizing it once.
 *
 * Session-only. A delegated credential must not be able to manage delegations.
 */
export const DELETE = handler({
	response: v.object({ ok: v.literal(true) }),
	async handle({ locals, params }) {
		const user = requireInteractiveSession(locals);
		const revoked = await revokeAgentGrant(user.id, params.grantId);
		if (!revoked) error(404, "no such agent");
		return { ok: true as const };
	},
});
