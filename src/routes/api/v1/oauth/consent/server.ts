import { error } from "@implementjs/kit/server";
import * as v from "valibot";
import { AGENT_GRANTABLE_SCOPES } from "@/lib/domain/agents";
import { OAuthConsentBody } from "@/lib/domain/schemas";
import { getAgentClient, grantAgentAccess } from "@/lib/server/agents.server";
import { auth } from "@/lib/server/auth.server";
import { requireInteractiveSession } from "@/lib/server/guards.server";
import { handler } from "./$types";

export const openapi = false;

/**
 * Answers an OAuth authorization request, and provisions the agent behind it.
 *
 * This is the moment an agent gains access, so it does the thing the OAuth flow
 * itself has no concept of: it records who approved it. That person's
 * memberships are the agent's reach, and their role in each is its ceiling.
 *
 * Order matters. The grant is written *before* the provider is told to accept,
 * because accepting is what mints the authorization code; a token that arrived
 * before its grant existed would resolve to nothing and read as unauthenticated.
 *
 * Session-only. Approving is the act of delegating, so a delegated credential
 * must not be able to do it and widen its own reach.
 */
export const POST = handler({
	body: OAuthConsentBody,
	response: v.object({ redirect: v.string() }),
	async handle({ locals, body, request }) {
		requireInteractiveSession(locals);

		if (!body.accept) {
			return { redirect: await answer(request, body.oauthQuery, false) };
		}

		const user = requireInteractiveSession(locals);

		// The client id comes from the signed query the provider handed us, not
		// from anything the browser chose to send alongside it.
		const clientId = new URLSearchParams(body.oauthQuery).get("client_id");
		if (clientId === null) error(400, "that authorization request is not valid");

		const client = await getAgentClient(clientId);
		if (client === null) error(404, "that application is no longer registered");

		// Never widen past what an agent may hold. The browser sends these, so
		// they are a request, not an authority.
		const requested = new Set(body.scopes);
		const scopes = AGENT_GRANTABLE_SCOPES.filter((scope) => requested.has(scope));
		if (scopes.length === 0) error(400, "choose at least one permission");

		await grantAgentAccess({
			clientId: client.clientId,
			installerUserId: user.id,
			scopes,
			harness: body.harness,
		});

		return { redirect: await answer(request, body.oauthQuery, true) };
	},
});

/**
 * Hands the decision to the provider and returns where to send the browser.
 *
 * The provider answers with a redirect envelope rather than a 302, because the
 * destination is the client's own loopback callback — the page has to navigate
 * there itself.
 */
async function answer(request: Request, oauthQuery: string, accept: boolean): Promise<string> {
	let result: unknown;
	try {
		result = await auth.api.oauth2Consent({
			body: { accept, oauth_query: oauthQuery },
			headers: request.headers,
			// The provider re-enters its authorize endpoint to mint the code, and
			// that path reads `ctx.request`. A server-side `auth.api` call carries
			// only headers unless a Request is handed over explicitly, and without
			// one it fails with "request not found".
			request,
		});
	} catch (cause) {
		// The provider rejects an expired or tampered query, and a bare 500 tells
		// nobody which. Surfacing its own message is what makes "your login timed
		// out, start again" distinguishable from a real fault.
		error(400, providerMessage(cause));
	}

	// Handing over a `request` makes the provider answer with a `Response` rather
	// than a plain object — and a constructed `Response` has its own empty `url`,
	// which would otherwise read as a successful redirect to nowhere.
	const payload: unknown = result instanceof Response ? await result.clone().json() : result;

	const url = (payload as { url?: unknown } | null)?.url;
	if (typeof url !== "string" || url === "") {
		error(500, "the authorization server did not return a redirect");
	}
	return url;
}

/**
 * better-auth throws `APIError`. OAuth failures put a code on `body.error`
 * (`invalid_signature`, `access_denied`…), while other failures use
 * `body.message`, so both are worth reading before falling back.
 */
function providerMessage(cause: unknown): string {
	if (typeof cause !== "object" || cause === null) return "that authorization request is not valid";
	const record = cause as {
		body?: { error?: unknown; error_description?: unknown; message?: unknown };
		message?: unknown;
	};
	if (typeof record.body?.error_description === "string") return record.body.error_description;
	if (typeof record.body?.error === "string") return record.body.error;
	if (typeof record.body?.message === "string") return record.body.message;
	if (typeof record.message === "string" && record.message !== "") return record.message;
	return "that authorization request is not valid";
}
