/**
 * The JSON-RPC half of the MCP endpoint.
 *
 * Hand-rolled rather than taken from `@modelcontextprotocol/sdk`, for two
 * reasons. The SDK's Streamable HTTP transport is written against Node's
 * `req`/`res`, while kit hands routes a Web `Request` and expects a `Response`;
 * and the SDK describes tools with zod, while every schema in this app is
 * already valibot — which `@valibot/to-json-schema` turns into the JSON Schema
 * a tool's `inputSchema` needs. Reusing the existing schemas is worth more here
 * than the SDK's plumbing.
 *
 * The server is deliberately stateless and JSON-only. The spec lets a server
 * answer a POSTed request with either `text/event-stream` or
 * `application/json`, and makes session ids and the GET stream optional — so a
 * server with no server-initiated messages is fully conformant without either,
 * and stays a plain function of its input.
 */

/** Protocol revisions this server knows how to speak, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** What a client that sent no `MCP-Protocol-Version` header is assumed to speak. */
export const ASSUMED_PROTOCOL_VERSION = "2025-03-26";

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export const JSON_RPC_ERRORS = {
	parseError: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internalError: -32603,
} as const;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== "object" || value === null) return false;
	const message = value as Record<string, unknown>;
	if (message.jsonrpc !== "2.0") return false;
	if (typeof message.method !== "string") return false;
	// A notification is exactly a message with no `id`, which is what separates
	// "answer this" from "an FYI" — and decides between a body and a bare 202.
	return typeof message.id === "string" || typeof message.id === "number";
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
	if (typeof value !== "object" || value === null) return false;
	const message = value as Record<string, unknown>;
	return message.jsonrpc === "2.0" && typeof message.method === "string";
}

export function rpcResult(id: string | number, result: unknown): Record<string, unknown> {
	return { jsonrpc: "2.0", id, result };
}

export function rpcError(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
): Record<string, unknown> {
	return {
		jsonrpc: "2.0",
		id,
		error: data === undefined ? { code, message } : { code, message, data },
	};
}

/** A `tools/call` result. Text content is kept alongside any structured data. */
export interface ToolResult {
	content: { type: "text"; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

/**
 * A tool failure, reported inside the result rather than as a JSON-RPC error.
 *
 * The spec draws this line deliberately: a protocol error means the call itself
 * was malformed, while `isError: true` means the call was understood and the
 * work failed. Only the latter reaches the model, which is what lets it read
 * "no workspace by that name" and try something else instead of stalling.
 */
export function toolFailure(message: string): ToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

/** A tool success. The JSON is duplicated as text for clients that ignore `structuredContent`. */
export function toolSuccess(data: unknown, summary?: string): ToolResult {
	const json = JSON.stringify(data, null, 2);
	return {
		content: [{ type: "text", text: summary === undefined ? json : `${summary}\n\n${json}` }],
		structuredContent: isPlainObject(data) ? data : { result: data },
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
