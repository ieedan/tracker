/**
 * Tool results kit's `mcp()` hands back untouched.
 *
 * `handle` returning a plain value is JSON for the model to read, which covers
 * every tool whose endpoint answers JSON — all but one. `read_attachment`
 * answers *bytes*, and the point of that tool is that a screenshot on an issue
 * becomes something the model can look at rather than a base64 string it
 * cannot. That needs an `image` (or `audio`) content block.
 *
 * Kit tells its own result envelopes apart from data that merely has a
 * `content` key by a symbol from the global registry, and only builds one for a
 * failure (`tool.failure`). So a successful non-text result has to carry the
 * same brand. Tracked upstream as implementjs ENG-26.
 */

/** The brand `@implementjs/kit/mcp` checks before passing a result through. */
const KIT_TOOL_RESULT = Symbol.for("@implementjs/kit:mcp-tool-result");

/**
 * One block of a tool's answer.
 *
 * Text covers everything the API returns as JSON. The binary blocks exist for
 * attachments: an image handed back as a `text` block is a base64 string the
 * model cannot look at, while an `image` block is a picture it can.
 */
export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| { type: "audio"; data: string; mimeType: string };

/** A `tools/call` result, as kit will serialize it. */
export interface ToolResult {
	content: ContentBlock[];
	isError?: boolean;
}

function branded(result: ToolResult): ToolResult {
	Object.defineProperty(result, KIT_TOOL_RESULT, { value: true, enumerable: false });
	return result;
}

/** Plain text, for a tool whose answer is not JSON. */
export function toolText(text: string): ToolResult {
	return branded({ content: [{ type: "text", text }] });
}

/**
 * Bytes the model can actually perceive, rather than a base64 string.
 *
 * `data` is base64 either way — the difference is the block type, which is what
 * tells the client to decode it and show the model a picture or play a sound.
 */
export function toolMedia(
	kind: "image" | "audio",
	data: string,
	mimeType: string,
	summary?: string,
): ToolResult {
	const media: ContentBlock = { type: kind, data, mimeType };
	return branded({
		content: summary === undefined ? [media] : [{ type: "text", text: summary }, media],
	});
}
