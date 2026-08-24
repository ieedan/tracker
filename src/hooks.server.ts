import { type Handle, redirect, sequence } from "@implementjs/kit/server";
import { presentedApiKey, resolveApiKey } from "@/lib/server/api-key.server";
import { auth } from "@/lib/server/auth.server";

/**
 * Resolves the caller once, for every request.
 *
 * An API key is checked first and never falls back to the cookie, so a request
 * carrying a revoked key is rejected rather than quietly running as whoever
 * happens to be signed in in that browser.
 */
const authenticate: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.authVia = null;

	const headers = event.request.headers;
	const key = presentedApiKey(headers);

	if (key !== null) {
		const principal = await resolveApiKey(key);
		if (principal !== null) {
			event.locals.user = principal.user;
			event.locals.authVia = "api-key";
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
