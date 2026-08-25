import { type Handle, redirect, sequence } from "@implementjs/kit/server";
import { API_KEY_PREFIX, presentedCredential, resolveApiKey } from "@/lib/server/api-key.server";
import { AGENT_REGISTRABLE_SCOPES } from "@/lib/domain/agents";
import { auth, MCP_RESOURCE, OAUTH_ISSUER } from "@/lib/server/auth.server";
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
					grantId: agent.grantId,
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
				harness: null,
			};
			event.locals.authVia = "session";
		}
	} catch {
		// A malformed or expired cookie is simply an unauthenticated request;
		// the guards below decide what that means for this route.
	}

	return await resolve(event);
};

/**
 * CORS for the MCP protocol surface.
 *
 * Cursor's HTTP client is Chromium, so a missing `Access-Control-Allow-Origin`
 * turns a perfectly good 401 into `net::ERR_FAILED` — the client never sees
 * `WWW-Authenticate` and never starts OAuth. Discovery, registration and token
 * exchange all have to be readable cross-origin; the authorize page does not,
 * because that is a top-level browser navigation.
 */
const MCP_CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID, MCP-Session-Id",
	"Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
	"Access-Control-Max-Age": "86400",
};

function isMcpCorsPath(pathname: string): boolean {
	return (
		pathname === "/api/mcp" ||
		pathname.startsWith("/.well-known/") ||
		pathname.startsWith("/api/auth/.well-known/") ||
		pathname === "/api/auth/jwks" ||
		pathname === "/api/auth/oauth2/register" ||
		pathname === "/api/auth/oauth2/token" ||
		pathname === "/api/auth/oauth2/revoke"
	);
}

const mcpCors: Handle = async ({ event, resolve }) => {
	if (!isMcpCorsPath(event.url.pathname)) return await resolve(event);
	if (event.request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
	}
	const response = await resolve(event);
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(key, value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};

/**
 * OAuth discovery documents for MCP clients.
 *
 * Served from a hook rather than a route because kit does not route a
 * `.well-known` directory — a dot-prefixed segment is not a valid route folder.
 *
 * Protected-resource metadata (RFC 9728) is answered at both the bare path and
 * the path-suffixed form (`/.well-known/oauth-protected-resource/api/mcp`).
 *
 * Authorization-server metadata is proxied from better-auth onto the paths
 * clients actually request: RFC 8414 inserts the issuer path
 * (`/.well-known/oauth-authorization-server/api/auth`), and Cursor omits it
 * (`/.well-known/oauth-authorization-server`). Without the latter, Cursor
 * never finds a token endpoint and shows zero tools with no way to sign in.
 */
const wellKnown: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith("/.well-known/oauth-protected-resource")) {
		return new Response(
			JSON.stringify({
				// Byte-for-byte the identifier the provider knows. A mismatch makes the
				// `resource` the client then sends fail as `invalid_target`.
				resource: MCP_RESOURCE,
				authorization_servers: [OAUTH_ISSUER],
				scopes_supported: AGENT_REGISTRABLE_SCOPES,
				bearer_methods_supported: ["header"],
				resource_documentation: new URL("/openapi.json", event.url.origin).href,
			}),
			{
				headers: {
					"content-type": "application/json",
					"cache-control": "public, max-age=3600",
				},
			},
		);
	}

	const upstream = authorizationServerMetadataPath(pathname);
	if (upstream !== null) {
		return await auth.handler(new Request(new URL(upstream, event.url.origin)));
	}

	return await resolve(event);
};

/** Maps a well-known request to the better-auth document that answers it. */
function authorizationServerMetadataPath(pathname: string): string | null {
	const issuerPath = new URL(OAUTH_ISSUER).pathname.replace(/\/$/, "");
	if (
		pathname === "/.well-known/oauth-authorization-server" ||
		pathname === `/.well-known/oauth-authorization-server${issuerPath}`
	) {
		return `${issuerPath}/.well-known/oauth-authorization-server`;
	}
	if (
		pathname === "/.well-known/openid-configuration" ||
		pathname === `/.well-known/openid-configuration${issuerPath}`
	) {
		return `${issuerPath}/.well-known/openid-configuration`;
	}
	return null;
}

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

export const handle = sequence(mcpCors, wellKnown, authenticate, guardApp);
