import { redirect } from "@implementjs/kit/server";
import { AGENT_GRANTABLE_SCOPES, guessHarness, type HarnessKind } from "@/lib/domain/agents";
import { getAgentClient, workspacesFor } from "@/lib/server/agents.server";
import type { LoadEvent } from "./$types";

/**
 * Where a person decides whether an agent may act in their workspace.
 *
 * This is the only consent surface: an MCP client runs the authorization-code
 * flow, and the provider redirects here with its signed authorization query.
 * That query is opaque and must be handed straight back — only `client_id` and
 * `scope` are read out of it, to say what is being asked for.
 *
 * `guardApp` covers only /app and /workspaces, so signing in is enforced here,
 * carrying the whole query through the round trip so nothing is lost.
 */
export default async function load({ locals, url }: LoadEvent) {
	if (locals.user === null) {
		const next = encodeURIComponent(url.pathname + url.search);
		redirect(303, `/login?next=${next}`);
	}

	const oauthQuery = url.search.replace(/^\?/, "");
	const clientId = url.searchParams.get("client_id");
	const client = clientId === null ? null : await getAgentClient(clientId);

	// Shown so the person can see the reach they are granting, not chosen from:
	// a grant covers every workspace they belong to, including ones joined later.
	const workspaces = await workspacesFor(locals.user.id);

	// Show only what this agent could actually be given. A client may ask for
	// more; consenting to something that would 403 on every call helps nobody.
	const asked = (url.searchParams.get("scope") ?? "").split(/\s+/);
	const scopes = AGENT_GRANTABLE_SCOPES.filter((scope) => asked.includes(scope));

	return {
		oauthQuery,
		client,
		workspaces,
		scopes: scopes.length > 0 ? scopes : ["issues:read"],
		// Only a default for the picker. The client's own name is a claim, so the
		// person confirms or corrects it before anything is created.
		guessedHarness: client === null ? ("other" as HarnessKind) : guessHarness(client.name),
	};
}
