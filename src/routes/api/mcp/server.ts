import { mcp } from "@implementjs/kit/mcp";
import { MCP_TOOLS } from "@/lib/server/mcp/tools.server";

/** Excluded from the REST document: this speaks JSON-RPC, not the v1 API. */
export const openapi = false;

/**
 * The MCP endpoint.
 *
 * The transport is kit's — stateless and JSON-only, which the Streamable HTTP
 * spec explicitly allows: a POSTed request may be answered with
 * `application/json` instead of an SSE stream, and both session ids and the GET
 * stream are optional. Nothing here pushes messages to a client, so neither is
 * needed, and the endpoint stays a pure function of one request.
 *
 * `authorize` is the only thing this app has to say about who may connect.
 * `false` gets the 401 with the `WWW-Authenticate: Bearer resource_metadata="…"`
 * challenge that tells an MCP client where to log in — served, as the challenge
 * says, from /.well-known/oauth-protected-resource.
 */
export const { POST, GET, DELETE } = mcp({
	serverInfo: { name: "tracker", title: "tracker", version: "1.0.0" },
	instructions:
		"An issue tracker. You act as your own member of one workspace — the one you were authorized into — so anything you file or comment on is attributed to you. Start with whoami if you need to know which workspace that is, and list_teams before creating an issue.",
	authorize: (event) => event.locals.agent !== null,
	tools: MCP_TOOLS,
});
