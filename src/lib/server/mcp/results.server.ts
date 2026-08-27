/**
 * Tool results for the answers that are not JSON.
 *
 * `handle` returning a plain value is JSON for the model to read, which covers
 * every tool whose endpoint answers JSON — all but one. `read_attachment`
 * answers *bytes*, and the point of that tool is that a screenshot on an issue
 * becomes something the model can look at rather than a base64 string it
 * cannot. That needs an `image` (or `audio`) content block.
 *
 * Kit builds those itself as of 0.0.16 (implementjs ENG-26), so this is a thin
 * naming layer over `tool.content` rather than the branded envelope it used to
 * have to forge out of a symbol kit did not export.
 */
import { tool, type ToolResult } from "@implementjs/kit/mcp";

export type { ToolResult };

/** Plain text, for a tool whose answer is not JSON. */
export function toolText(text: string): ToolResult {
	return tool.content({ type: "text", text });
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
	const media = { type: kind, data, mimeType } as const;
	return summary === undefined
		? tool.content(media)
		: tool.content({ type: "text", text: summary }, media);
}
