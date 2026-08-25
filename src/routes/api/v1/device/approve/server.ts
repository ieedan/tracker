import { error } from "@implementjs/kit/server";
import * as v from "valibot";
import { AGENT_GRANTABLE_SCOPES } from "@/lib/domain/agents";
import { ApproveDeviceBody } from "@/lib/domain/schemas";
import { getAgentClient, grantAgentAccess } from "@/lib/server/agents.server";
import { auth } from "@/lib/server/auth.server";
import { requireInteractiveSession, requireMembership } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * Approves a device authorization, letting an agent into one workspace.
 *
 * This is the moment a bot member comes into existence, so it does the two
 * things the OAuth flow itself cannot: it binds the grant to a workspace the
 * approver actually belongs to, and it records who approved it — the human
 * whose access will cap the agent's from here on.
 *
 * Session-only. Approving is the act of delegating, so a delegated credential
 * must not be able to do it and widen its own reach.
 */
export const POST = handler({
	body: ApproveDeviceBody,
	response: v.object({ ok: v.literal(true) }),
	async handle({ locals, body, request }) {
		requireInteractiveSession(locals);
		const membership = await requireMembership(locals, body.slug);

		const verification = await auth.api.deviceVerify({
			query: { user_code: body.userCode },
			headers: request.headers,
		});

		const clientId = clientIdOf(verification);
		if (clientId === null) error(404, "that code is not valid");

		const client = await getAgentClient(clientId);
		if (client === null) error(404, "that application is no longer registered");

		// Never widen what was asked for, and never past what an agent may hold —
		// the browser is the one sending these, so they are not to be trusted.
		const requested = new Set(body.scopes);
		const scopes = AGENT_GRANTABLE_SCOPES.filter((scope) => requested.has(scope));
		if (scopes.length === 0) error(400, "choose at least one permission");

		await grantAgentAccess({
			client,
			workspaceId: membership.workspace.id,
			installerUserId: membership.user.id,
			scopes,
			harness: body.harness,
			name: body.name ?? "",
		});

		await auth.api.deviceApprove({
			body: { userCode: body.userCode },
			headers: request.headers,
		});

		return { ok: true as const };
	},
});

/** The device code's client, whatever shape the plugin reports it in. */
function clientIdOf(verification: unknown): string | null {
	if (typeof verification !== "object" || verification === null) return null;
	const record = verification as Record<string, unknown>;
	for (const key of ["oauthClientId", "clientId", "client_id"]) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	const client = record.client;
	if (typeof client === "object" && client !== null) {
		const value = (client as Record<string, unknown>).clientId;
		if (typeof value === "string" && value !== "") return value;
	}
	return null;
}
