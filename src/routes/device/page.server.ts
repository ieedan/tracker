import { redirect } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { AGENT_GRANTABLE_SCOPES } from "@/lib/domain/agents";
import { getAgentClient } from "@/lib/server/agents.server";
import { auth } from "@/lib/server/auth.server";
import { db } from "@/lib/server/db.server";
import { workspace, workspaceMember } from "@/lib/server/schema.server";
import type { LoadEvent } from "./$types";

/**
 * The device authorization consent screen.
 *
 * `guardApp` only covers /app and /workspaces, so signing in is enforced here.
 * The user code is carried through the redirect so someone who arrives from
 * `verification_uri_complete` does not have to retype it after logging in.
 */
export default async function load({ locals, url, request }: LoadEvent) {
	const userCode = (url.searchParams.get("user_code") ?? "").trim().toUpperCase();

	if (locals.user === null) {
		const next = encodeURIComponent(url.pathname + url.search);
		redirect(303, `/login?next=${next}`);
	}

	const workspaces = await db
		.select({ slug: workspace.slug, name: workspace.name })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(eq(workspaceMember.userId, locals.user.id))
		.orderBy(workspace.name);

	if (userCode === "") return { userCode: "", request: null, workspaces };

	// A bad code is not an error page — it is the same screen with a message,
	// so someone who mistyped can simply try again.
	let agentRequest: AgentRequest | null = null;
	try {
		const verification = await auth.api.deviceVerify({
			query: { user_code: userCode },
			headers: request.headers,
		});
		agentRequest = await describe(verification);
	} catch {
		agentRequest = null;
	}

	return { userCode, request: agentRequest, workspaces };
}

interface AgentRequest {
	clientId: string;
	name: string;
	icon: string | null;
	uri: string | null;
	trusted: boolean;
	scopes: string[];
}

async function describe(verification: unknown): Promise<AgentRequest | null> {
	if (typeof verification !== "object" || verification === null) return null;
	const record = verification as Record<string, unknown>;

	const clientId = firstString(record, ["oauthClientId", "clientId", "client_id"]);
	if (clientId === null) return null;

	const client = await getAgentClient(clientId);
	if (client === null) return null;

	// Show only what this agent could actually be given. A client may ask for
	// more; consenting to something that would 403 on every call helps nobody.
	const asked = String(record.scope ?? "").split(/\s+/);
	const scopes = AGENT_GRANTABLE_SCOPES.filter((scope) => asked.includes(scope));

	return { ...client, scopes: scopes.length > 0 ? scopes : ["issues:read"] };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return null;
}
