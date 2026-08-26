/**
 * Exercises the MCP route end to end.
 *
 *   pnpm verify:mcp
 *
 * The app's own /api/v1 is stubbed, and nothing else is: the JSON-RPC
 * transport, the origin and authorization checks, the valibot validation of
 * every call's arguments, and each tool's handle all run for real. What it
 * asserts is the contract an MCP client sees — the tools that exist, the shapes
 * they take, the endpoint each one reaches, and what comes back — so a change
 * underneath (a kit upgrade, a reshuffled tool) has to keep that contract or
 * this says which part of it broke.
 */
import { DELETE, GET, POST } from "../src/routes/api/mcp/server.ts";

const ORIGIN = "https://tracker.test";

/** Every /api/v1 call the tools made, so a test can assert on the URL and body. */
const calls: { method: string; path: string; body: unknown; authorization: string | null }[] = [];

let nextApiResponse: () => Response = () => json({ ok: true });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(String(input));
	calls.push({
		method: init?.method ?? "GET",
		path: `${url.pathname}${url.search}`,
		body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
		authorization: new Headers(init?.headers).get("authorization"),
	});
	if (url.pathname === "/api/v1/workspaces") {
		return json([{ slug: "tracker", name: "tracker" }]);
	}
	return nextApiResponse();
}) as typeof fetch;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

type Options = { agent?: unknown; origin?: string | null; protocolVersion?: string | null };

function event(request: Request, options: Options = {}): never {
	return {
		request,
		url: new URL(request.url),
		locals: { agent: "agent" in options ? options.agent : { id: "agent_1" } },
		params: {},
		cookies: {},
		route: { id: "/api/mcp" },
	} as never;
}

function rpc(
	method: string,
	params?: unknown,
	id: string | number | null = 1,
	options: Options = {},
) {
	const headers = new Headers({ "content-type": "application/json" });
	if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
	if (options.protocolVersion !== null) {
		headers.set("mcp-protocol-version", options.protocolVersion ?? "2025-06-18");
	}
	const body: Record<string, unknown> = { jsonrpc: "2.0", method };
	if (id !== null) body.id = id;
	if (params !== undefined) body.params = params;
	return new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function post(method: string, params?: unknown, options: Options = {}) {
	const response = await POST(event(rpc(method, params, 1, options), options));
	return { response, body: response.status === 202 ? null : ((await response.json()) as never) };
}

async function call(name: string, args: Record<string, unknown> = {}, options: Options = {}) {
	const { body } = await post("tools/call", { name, arguments: args }, options);
	return (body as { result: { content: { type: string; text?: string }[]; isError?: boolean } })
		.result;
}

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}`);
	if (detail !== undefined) console.log(`       ${JSON.stringify(detail)}`);
}

function section(name: string) {
	console.log(`\n${name}`);
}

// ---------------------------------------------------------------- transport

section("initialize");
{
	const { body } = await post("initialize", { protocolVersion: "2025-03-26" });
	const result = body.result as Record<string, unknown>;
	check("answers in the client's version", result.protocolVersion === "2025-03-26", result);
	check(
		"names the server",
		JSON.stringify(result.serverInfo) ===
			JSON.stringify({
				name: "tracker",
				title: "tracker",
				version: "1.0.0",
			}),
		result.serverInfo,
	);
	check("carries instructions", String(result.instructions).startsWith("An issue tracker."));
	check(
		"advertises tools",
		JSON.stringify(result.capabilities) === JSON.stringify({ tools: { listChanged: false } }),
		result.capabilities,
	);
}
{
	const { body } = await post("initialize", { protocolVersion: "1999-01-01" });
	check(
		"falls back to the latest version for an unknown one",
		(body.result as Record<string, unknown>).protocolVersion === "2025-06-18",
	);
}

section("protocol plumbing");
{
	const { body } = await post("ping");
	check("ping answers an empty result", JSON.stringify(body.result) === "{}");
}
{
	const { body } = await post("nonsense/method");
	check("unknown method is -32601", (body.error as { code: number }).code === -32601, body.error);
}
{
	const request = rpc("notifications/initialized", undefined, null);
	const response = await POST(event(request));
	check("a notification gets a bare 202", response.status === 202);
}
{
	const response = await POST(
		event(
			new Request(`${ORIGIN}/api/mcp`, {
				method: "POST",
				headers: { origin: ORIGIN, "mcp-protocol-version": "2025-06-18" },
				body: "{",
			}),
		),
	);
	const body = (await response.json()) as { error: { code: number } };
	check("bad JSON is a parse error", response.status === 400 && body.error.code === -32700);
}
{
	const { response } = await post("initialize", {}, { protocolVersion: "2019-01-01" });
	check("an unsupported protocol version is rejected", response.status === 400);
}
{
	const { response } = await post("initialize", {}, { protocolVersion: null });
	check("an absent protocol version is assumed, not rejected", response.status === 200);
}

section("origin and authorization");
{
	const { response } = await post("initialize", {}, { origin: "https://evil.test" });
	check("a foreign web origin is refused", response.status === 403);
}
{
	const { response } = await post("initialize", {}, { origin: "vscode-file://vscode-app" });
	check("a native client's origin is allowed", response.status === 200);
}
{
	const { response } = await post("initialize", {}, { origin: null });
	check("no origin header is allowed", response.status === 200);
}
{
	const response = await POST(event(rpc("initialize"), { agent: null }));
	check("an unauthenticated POST is 401", response.status === 401);
	check(
		"the challenge points at the resource metadata",
		response.headers.get("www-authenticate") ===
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
		response.headers.get("www-authenticate"),
	);
}
{
	const request = new Request(`${ORIGIN}/api/mcp`, { headers: { origin: ORIGIN } });
	const authed = await GET(event(request));
	check(
		"GET is 405 with an allow header",
		authed.status === 405 && authed.headers.get("allow") === "POST",
	);
	const anonymous = await GET(event(request, { agent: null }));
	check("an unauthenticated GET is 401", anonymous.status === 401);
	const deleted = await DELETE(
		event(new Request(`${ORIGIN}/api/mcp`, { method: "DELETE", headers: { origin: ORIGIN } })),
	);
	check("DELETE is 405", deleted.status === 405);
}

// -------------------------------------------------------------------- tools

section("tools/list");
const listed = await (async () => {
	const { body } = await post("tools/list");
	return (body.result as { tools: Record<string, never>[] }).tools;
})();
{
	check("every tool is listed", listed.length === 23, listed.length);
	const names = listed.map((entry) => String(entry.name));
	check(
		"names are unchanged",
		names.join(",") ===
			[
				"whoami",
				"list_workspaces",
				"list_issues",
				"get_issue",
				"create_issue",
				"update_issue",
				"delete_issue",
				"transfer_issue",
				"list_comments",
				"read_attachment",
				"comment_on_issue",
				"link_pull_request",
				"list_repositories",
				"list_teams",
				"list_labels",
				"create_label",
				"list_members",
				"get_workspace",
				"list_feedback",
				"get_feedback",
				"update_feedback",
				"convert_feedback_to_issue",
				"list_notifications",
			].join(","),
		names,
	);
	check(
		"every tool has an object inputSchema",
		listed.every((entry) => (entry.inputSchema as { type?: string }).type === "object"),
	);
	check(
		"every tool has a title and a description",
		listed.every(
			(entry) => typeof entry.title === "string" && typeof entry.description === "string",
		),
	);
	const unscoped = new Set(["whoami", "list_workspaces", "list_notifications"]);
	const missingWorkspace = listed
		.filter((entry) => !unscoped.has(String(entry.name)))
		.filter(
			(entry) =>
				(entry.inputSchema as { properties?: Record<string, unknown> }).properties?.workspace ===
				undefined,
		)
		.map((entry) => entry.name);
	check(
		"every scoped tool advertises `workspace`",
		missingWorkspace.length === 0,
		missingWorkspace,
	);
	const readOnly = listed
		.filter((entry) => (entry.annotations as { readOnlyHint?: boolean }).readOnlyHint === true)
		.map((entry) => String(entry.name));
	check(
		"writes are not marked read-only",
		!readOnly.includes("create_issue") && readOnly.includes("get_issue"),
	);
	check(
		"delete_issue is the destructive one",
		listed
			.filter(
				(entry) => (entry.annotations as { destructiveHint?: boolean }).destructiveHint === true,
			)
			.map((entry) => entry.name)
			.join(",") === "delete_issue",
	);
	const issueSchema = listed.find((entry) => entry.name === "list_issues")!.inputSchema as {
		properties: Record<string, { description?: string; type?: string }>;
	};
	check(
		"valibot descriptions survive the conversion",
		issueSchema.properties.team?.description === 'Team key, e.g. "ENG".',
		issueSchema.properties.team,
	);
}

section("tools/call — dispatch");
calls.length = 0;
{
	nextApiResponse = () => json({ id: "agent_1", name: "Claude Code" });
	const result = await call("whoami");
	check("whoami reaches /api/v1/me", calls.at(-1)?.path === "/api/v1/me", calls.at(-1));
	check(
		"its answer is the endpoint's JSON",
		result.content[0]?.text?.includes("Claude Code") === true,
		result,
	);
	check("and is not an error", result.isError === undefined);
}
{
	calls.length = 0;
	nextApiResponse = () => json([]);
	await call("list_issues", {
		status: ["todo", "in_progress"],
		q: "webhook",
		workspace: "tracker",
	});
	check(
		"filters become repeated query params",
		calls.at(-1)?.path ===
			"/api/v1/workspaces/tracker/issues?status=todo&status=in_progress&q=webhook",
		calls.at(-1),
	);
}
{
	calls.length = 0;
	nextApiResponse = () => json([]);
	await call("list_members");
	check(
		"a scoped tool resolves the only workspace itself",
		calls[0]?.path === "/api/v1/workspaces" &&
			calls[1]?.path === "/api/v1/workspaces/tracker/members",
		calls,
	);
}
{
	calls.length = 0;
	nextApiResponse = () => json({ identifier: "ENG-1" });
	await call("create_issue", { teamKey: "ENG", title: "A new issue", workspace: "tracker" });
	const posted = calls.at(-1)?.body as Record<string, unknown>;
	check(
		"a write POSTs the body without `workspace`",
		calls.at(-1)?.method === "POST" &&
			posted.workspace === undefined &&
			posted.teamKey === "ENG" &&
			posted.title === "A new issue",
		calls.at(-1),
	);
	check(
		"the schema's own defaults come through",
		posted.status === "backlog" && posted.priority === "none" && posted.description === "",
		posted,
	);
}
{
	calls.length = 0;
	nextApiResponse = () => json({ identifier: "ENG-1" });
	await call("update_issue", {
		identifier: " eng-1 ",
		changes: { status: "done" },
		workspace: "tracker",
	});
	check(
		"an identifier is trimmed, upper-cased and escaped into the path",
		calls.at(-1)?.path === "/api/v1/workspaces/tracker/issues/ENG-1",
		calls.at(-1),
	);
	check(
		"a partial update sends only the fields it was given",
		JSON.stringify(calls.at(-1)?.body) === JSON.stringify({ status: "done" }),
		calls.at(-1)?.body,
	);
}
{
	calls.length = 0;
	nextApiResponse = () => new Response(null, { status: 204 });
	const result = await call("delete_issue", { identifier: "ENG-1", workspace: "tracker" });
	check("delete_issue DELETEs", calls.at(-1)?.method === "DELETE", calls.at(-1));
	check("an empty body is not an error", result.isError === undefined, result);
}
{
	const request = rpc("tools/call", { name: "whoami", arguments: {} });
	request.headers.set("authorization", "Bearer token-123");
	calls.length = 0;
	nextApiResponse = () => json({});
	await POST(event(request));
	check(
		"the agent's token is forwarded",
		calls.at(-1)?.authorization === "Bearer token-123",
		calls.at(-1),
	);
}

section("tools/call — failures the model can read");
{
	const result = await call("no_such_tool");
	check(
		"an unknown tool is a tool error",
		result.isError === true && result.content[0]?.text?.includes("no_such_tool") === true,
		result,
	);
}
{
	const result = await call("get_issue", { identifier: 42, workspace: "tracker" });
	check("input the schema rejects is a tool error", result.isError === true, result);
	check(
		"and it says what was wrong",
		result.content[0]?.text?.includes("identifier") === true,
		result.content[0],
	);
}
{
	nextApiResponse = () => json({ message: "No issue ENG-999" }, 404);
	const result = await call("get_issue", { identifier: "ENG-999", workspace: "tracker" });
	check(
		"an endpoint's error message reaches the model with its status",
		result.isError === true && result.content[0]?.text === "No issue ENG-999 (HTTP 404)",
		result,
	);
}
{
	const before = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("connection refused");
	}) as typeof fetch;
	const result = await call("whoami");
	check("an unreachable API is a tool error, not a crash", result.isError === true, result);
	globalThis.fetch = before;
}

section("read_attachment");
{
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
	nextApiResponse = () =>
		new Response(png, {
			headers: {
				"content-type": "image/png",
				"content-disposition": 'attachment; filename="shot.png"',
			},
		});
	const result = await call("read_attachment", { id: "att_1", workspace: "tracker" });
	const image = result.content.find((block) => block.type === "image") as
		| { type: string; data: string; mimeType: string }
		| undefined;
	check(
		"an image comes back as an image block",
		image !== undefined,
		result.content.map((b) => b.type),
	);
	check("with the right mime type", image?.mimeType === "image/png", image?.mimeType);
	check("and the bytes intact", image?.data === png.toString("base64"));
	check("named by its filename", result.content[0]?.text === "shot.png", result.content[0]);
}
{
	nextApiResponse = () =>
		new Response("hello, world", {
			headers: {
				"content-type": "text/plain",
				"content-disposition": 'attachment; filename="notes.txt"',
			},
		});
	const result = await call("read_attachment", { id: "att_2", workspace: "tracker" });
	check(
		"a text file comes back as its characters",
		result.content[0]?.text === "notes.txt\n\nhello, world",
		result.content[0],
	);
}
{
	nextApiResponse = () =>
		new Response(new Uint8Array(8), {
			headers: {
				"content-type": "video/mp4",
				"content-length": String(20 * 1024 * 1024),
				"content-disposition": 'attachment; filename="clip.mp4"',
			},
		});
	const result = await call("read_attachment", { id: "att_3", workspace: "tracker" });
	check(
		"an oversized file is refused with its size",
		result.isError === true && result.content[0]?.text?.includes("20 MB") === true,
		result.content[0],
	);
}
{
	nextApiResponse = () =>
		new Response(new Uint8Array(8), {
			headers: {
				"content-type": "application/zip",
				"content-disposition": 'attachment; filename="bundle.zip"',
			},
		});
	const result = await call("read_attachment", { id: "att_4", workspace: "tracker" });
	check(
		"an unreadable type says so rather than dumping base64",
		result.isError === true,
		result.content[0],
	);
}

section("workspace resolution");
{
	const before = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		if (url.pathname === "/api/v1/workspaces") {
			return json([
				{ slug: "tracker", name: "tracker" },
				{ slug: "implementjs", name: "implementjs" },
			]);
		}
		return json([]);
	}) as typeof fetch;
	const ambiguous = await call("list_teams");
	check(
		"two workspaces and no `workspace` names the options",
		ambiguous.isError === true &&
			ambiguous.content[0]?.text ===
				"Pass `workspace` — you can act in: tracker (tracker), implementjs (implementjs)",
		ambiguous.content[0],
	);
	const named = await call("list_teams", { workspace: "implementjs" });
	check("naming one resolves it", named.isError === undefined, named);

	globalThis.fetch = (async () => json([])) as typeof fetch;
	const none = await call("list_teams");
	check(
		"no workspaces at all says why",
		none.isError === true && none.content[0]?.text?.includes("not a member") === true,
		none.content[0],
	);
	globalThis.fetch = before;
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
