import { type Handle, redirect, sequence } from "@implementjs/kit/server";
import { API_KEY_PREFIX, presentedCredential, resolveApiKey } from "@/lib/server/api-key.server";
import { auth } from "@/lib/server/auth.server";
import { resolveAgentToken } from "@/lib/server/oauth.server";

/**
 * Resolves the caller once, for every request.
 *
 * A presented credential is checked first and never falls back to the cookie,
 * so a request carrying a revoked key or token is rejected rather than quietly
 * running as whoever happens to be signed in in that browser.
 *
 * API keys and agent access tokens share the `Authorization: Bearer` header, so
 * they are told apart by the key prefix. Only keys carry it.
 */
const authenticate: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.authVia = null;
	event.locals.permissions = null;
	event.locals.agent = null;

	const headers = event.request.headers;
	const presented = presentedCredential(headers);

	if (presented !== null) {
		if (presented.startsWith(API_KEY_PREFIX)) {
			const principal = await resolveApiKey(presented);
			if (principal !== null) {
				event.locals.user = principal.user;
				event.locals.authVia = "api-key";
				event.locals.permissions = principal.permissions;
			}
		} else {
			const agent = await resolveAgentToken(presented);
			if (agent !== null) {
				// The bot, not the human who authorized it. Every write site stamps
				// `locals.user.id`, so this is what puts the agent's name on its work.
				event.locals.user = agent.user;
				event.locals.authVia = "oauth";
				event.locals.permissions = agent.permissions;
				event.locals.agent = {
					agentIdentityId: agent.agentIdentityId,
					workspaceId: agent.workspaceId,
					installedByUserId: agent.installedByUserId,
					clientId: agent.clientId,
				};
			}
		}
		return await resolve(event);
	}

	try {
		const result = await auth.api.getSession({ headers });
		if (result !== null) {
			event.locals.user = {
				id: result.user.id,
				name: result.user.name,
				email: result.user.email,
				image: result.user.image ?? null,
				type: "human",
			};
			event.locals.authVia = "session";
		}
	} catch {
		// A malformed or expired cookie is simply an unauthenticated request;
		// the guards below decide what that means for this route.
	}

	return await resolve(event);
};

/** Everything under /app and /workspaces is the signed-in product. */
const PRIVATE_PREFIXES = ["/app", "/workspaces"];

const guardApp: Handle = async ({ event, resolve }) => {
	const isPrivate = PRIVATE_PREFIXES.some((prefix) => event.url.pathname.startsWith(prefix));
	if (isPrivate && event.locals.user === null) {
		const next = encodeURIComponent(event.url.pathname + event.url.search);
		redirect(303, `/login?next=${next}`);
	}
	return await resolve(event);
};

export const handle = sequence(authenticate, guardApp);
