import {
	ASSUMED_PROTOCOL_VERSION,
	isJsonRpcMessage,
	isJsonRpcRequest,
	JSON_RPC_ERRORS,
	LATEST_PROTOCOL_VERSION,
	rpcError,
	rpcResult,
	SUPPORTED_PROTOCOL_VERSIONS,
	toolFailure,
	toolSuccess,
	type ToolResult,
} from "@/lib/server/mcp/protocol.server";
import { describeTools, MCP_TOOLS_BY_NAME } from "@/lib/server/mcp/tools.server";
import type { RequestEvent } from "./$types";

/** Excluded from the REST document: this speaks JSON-RPC, not the v1 API. */
export const openapi = false;

const SERVER_INFO = { name: "tracker", title: "tracker", version: "1.0.0" };

/**
 * The MCP endpoint.
 *
 * Stateless and JSON-only, which the Streamable HTTP transport explicitly
 * allows: a POSTed request may be answered with `application/json` instead of
 * an SSE stream, and both session ids and the GET stream are optional. Nothing
 * here pushes messages to a client, so neither is needed, and the endpoint
 * stays a pure function of one request.
 */
export async function POST(event: RequestEvent): Promise<Response> {
	const originError = checkOrigin(event);
	if (originError !== null) return originError;

	const versionError = checkProtocolVersion(event);
	if (versionError !== null) return versionError;

	// Authorization comes before parsing: an unauthenticated client needs the
	// challenge that tells it where to authenticate, not a parse error.
	if (event.locals.agent === null) return unauthorized(event);

	let payload: unknown;
	try {
		payload = await event.request.json();
	} catch {
		return json(rpcError(null, JSON_RPC_ERRORS.parseError, "Invalid JSON"), 400);
	}

	// Batches were removed in 2025-06-18 and this server does not accept them.
	if (Array.isArray(payload)) {
		return json(
			rpcError(null, JSON_RPC_ERRORS.invalidRequest, "Batched requests are not supported"),
			400,
		);
	}

	if (!isJsonRpcMessage(payload)) {
		return json(rpcError(null, JSON_RPC_ERRORS.invalidRequest, "Not a JSON-RPC message"), 400);
	}

	// A notification or response has no `id` and gets no body — the spec is
	// specific that this is a bare 202 rather than an empty result.
	if (!isJsonRpcRequest(payload)) {
		return new Response(null, { status: 202 });
	}

	const { id, method } = payload;
	const params = (payload.params ?? {}) as Record<string, unknown>;

	switch (method) {
		case "initialize":
			return json(rpcResult(id, initialize(params)));
		case "ping":
			return json(rpcResult(id, {}));
		case "tools/list":
			return json(rpcResult(id, { tools: describeTools() }));
		case "tools/call":
			return json(rpcResult(id, await callTool(event, params)));
		default:
			return json(rpcError(id, JSON_RPC_ERRORS.methodNotFound, `Unknown method: ${method}`));
	}
}

/**
 * No server-initiated stream, so no GET stream to open.
 *
 * 405 is the spec's designated way to say so, and clients treat it as "this
 * server just answers requests" rather than as a failure.
 */
export function GET(event: RequestEvent): Response {
	const originError = checkOrigin(event);
	if (originError !== null) return originError;
	if (event.locals.agent === null) return unauthorized(event);
	return new Response(null, { status: 405, headers: { allow: "POST" } });
}

/** Nothing to terminate: the server holds no session. */
export function DELETE(event: RequestEvent): Response {
	const originError = checkOrigin(event);
	if (originError !== null) return originError;
	return new Response(null, { status: 405, headers: { allow: "POST" } });
}

function initialize(params: Record<string, unknown>): Record<string, unknown> {
	// Answer in the client's version when it is one we speak, so an older client
	// is not forced to downgrade the connection itself.
	const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
	const agreed = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
		? asked
		: LATEST_PROTOCOL_VERSION;

	return {
		protocolVersion: agreed,
		capabilities: { tools: { listChanged: false } },
		serverInfo: SERVER_INFO,
		instructions:
			"An issue tracker. You act as your own member of one workspace — the one you were authorized into — so anything you file or comment on is attributed to you. Start with whoami if you need to know which workspace that is, and list_teams before creating an issue.",
	};
}

async function callTool(event: RequestEvent, params: Record<string, unknown>): Promise<ToolResult> {
	const name = typeof params.name === "string" ? params.name : "";
	const tool = MCP_TOOLS_BY_NAME.get(name);
	if (tool === undefined) return toolFailure(`Unknown tool: ${name}`);

	const args = (params.arguments ?? {}) as Record<string, unknown>;
	if (event.locals.agent === null) return toolFailure("Not authenticated");

	let slug = "";
	if (tool.scoped) {
		const resolved = await resolveWorkspace(event, args);
		if (typeof resolved !== "string") return resolved;
		slug = resolved;
	}

	const { method, path, body } = tool.request(args, slug);

	// Dispatched back through the app's own HTTP API rather than reaching into
	// the database. It costs a local round trip and buys one implementation of
	// every rule: permissions, the never-admin cap, webhook events, and the
	// notifications a write is supposed to produce.
	const response = await apiFetch(event, method, path, body);
	if (response === null) return toolFailure("Could not reach the API");

	// A failure is JSON whatever the tool normally answers with, so it is read
	// the same way before the tool gets a look at the body.
	if (!response.ok) return await failureFrom(response);

	// A tool whose endpoint answers bytes shapes its own result; everything else
	// takes the JSON default.
	if (tool.result !== undefined) return await tool.result(response);

	const text = await response.text();
	let parsed: unknown = text;
	try {
		parsed = text === "" ? null : JSON.parse(text);
	} catch {
		// Leave it as text; a non-JSON body is still worth showing the model.
	}

	return toolSuccess(parsed);
}

/** An error response, as the message the endpoint put in it. */
async function failureFrom(response: Response): Promise<ToolResult> {
	const text = await response.text();
	let parsed: unknown = text;
	try {
		parsed = text === "" ? null : JSON.parse(text);
	} catch {
		// Not JSON; the status is all there is to say.
	}
	const message =
		typeof parsed === "object" && parsed !== null && "message" in parsed
			? String((parsed as { message: unknown }).message)
			: `Request failed with ${response.status}`;
	return toolFailure(`${message} (HTTP ${response.status})`);
}

/**
 * Which workspace a scoped tool acts in.
 *
 * A grant covers every workspace its approver belongs to, so the model has to
 * say — unless there is only one, which is the usual case and not worth making
 * it look up. Anything else is a tool error naming the options, so the model can
 * retry with one rather than guess.
 */
async function resolveWorkspace(
	event: RequestEvent,
	args: Record<string, unknown>,
): Promise<string | ToolResult> {
	const asked = typeof args.workspace === "string" ? args.workspace.trim() : "";
	if (asked !== "") return asked;

	const response = await apiFetch(event, "GET", "/api/v1/workspaces");
	if (response === null) return toolFailure("Could not reach the API");

	const workspaces = (await response.json()) as { slug: string; name: string }[];
	if (workspaces.length === 1) return workspaces[0]!.slug;
	if (workspaces.length === 0) {
		return toolFailure(
			"You cannot reach any workspace. The person who authorized you is not a member of one.",
		);
	}
	const options = workspaces.map((entry) => `${entry.slug} (${entry.name})`).join(", ");
	return toolFailure(`Pass \`workspace\` — you can act in: ${options}`);
}

/** One call back through the app's own API, carrying the agent's token. */
async function apiFetch(
	event: RequestEvent,
	method: string,
	path: string,
	body?: unknown,
): Promise<Response | null> {
	const authorization = event.request.headers.get("authorization");
	try {
		return await fetch(new URL(path, event.url.origin), {
			method,
			headers: {
				"content-type": "application/json",
				...(authorization === null ? {} : { authorization }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		return null;
	}
}

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/**
 * The 401 an MCP client needs in order to discover where to authenticate.
 *
 * `WWW-Authenticate` with `resource_metadata` is what RFC 9728 defines and what
 * the MCP spec requires — without it a client has no way to find the
 * authorization server, and simply fails instead of starting a login.
 */
function unauthorized(event: RequestEvent): Response {
	const metadata = new URL("/.well-known/oauth-protected-resource", event.url.origin);
	return new Response(
		JSON.stringify({ error: "invalid_token", error_description: "Authentication required" }),
		{
			status: 401,
			headers: {
				"content-type": "application/json",
				"www-authenticate": `Bearer resource_metadata="${metadata.href}"`,
			},
		},
	);
}

/**
 * DNS-rebinding protection, which the transport spec requires.
 *
 * A web page cannot forge `Origin`, so an `http(s)` origin that is not this
 * app is a site acting on its own behalf and is rejected. Native MCP clients
 * are not websites: Cursor sends `vscode-file://vscode-app` (and sometimes the
 * literal `"null"`). Treating those like a DNS-rebinding attack answers 403
 * instead of the 401 + `WWW-Authenticate` that starts OAuth, which is why
 * Cursor showed the server as connected with zero tools and no way to log in.
 */
function checkOrigin(event: RequestEvent): Response | null {
	const origin = event.request.headers.get("origin");
	if (originAllowed(origin, event.url.origin)) return null;
	return json(rpcError(null, JSON_RPC_ERRORS.invalidRequest, `Origin not allowed: ${origin}`), 403);
}

function originAllowed(origin: string | null, serverOrigin: string): boolean {
	if (origin === null || origin === "null" || origin === serverOrigin) return true;
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		return false;
	}
	return parsed.protocol !== "http:" && parsed.protocol !== "https:";
}

function checkProtocolVersion(event: RequestEvent): Response | null {
	const header = event.request.headers.get("mcp-protocol-version");
	// Absent means an older client; the spec says assume 2025-03-26 rather than
	// reject, so a 2024-era client still connects.
	const version = header ?? ASSUMED_PROTOCOL_VERSION;
	if ((SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) return null;
	return json(
		rpcError(
			null,
			JSON_RPC_ERRORS.invalidRequest,
			`Unsupported MCP-Protocol-Version: ${version}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
		),
		400,
	);
}
