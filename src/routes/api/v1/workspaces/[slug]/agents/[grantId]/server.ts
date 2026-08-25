import { error } from "@implementjs/kit/server";
import * as v from "valibot";
import { UpdateAgentBody } from "@/lib/domain/schemas";
import { renameAgent, revokeAgentGrant } from "@/lib/server/agents.server";
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

/**
 * Renames an agent, or corrects which harness it is.
 *
 * Admin-only and session-only, like revoking: the name is what appears on every
 * comment the bot has written, so it is workspace-wide, and an agent must not
 * be able to re-label itself as something more trusted.
 */
export const PATCH = handler({
	body: UpdateAgentBody,
	response: v.object({ ok: v.literal(true) }),
	async handle({ locals, params, body }) {
		requireInteractiveSession(locals);
		const membership = requireAdmin(await requireMembership(locals, params.slug));

		const updated = await renameAgent(membership.workspace.id, params.grantId, body);
		if (!updated) error(404, "no such agent");

		return { ok: true as const };
	},
});
