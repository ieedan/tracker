/**
 * What the MCP server lets an agent do.
 *
 * Every tool is a binding to an existing `/api/v1` endpoint rather than a
 * second implementation of the same rules. Issue creation alone allocates a
 * team-scoped number, validates labels and assignees, writes notifications and
 * emits a webhook — none of which should exist twice and drift. Calling the
 * route means a tool inherits all of it, including the permission ceiling and
 * the never-admin cap, for free.
 *
 * Schemas are the app's own valibot schemas. `@implementjs/kit/mcp` validates
 * each call against them and converts them for `tools/list`, so a tool's
 * advertised `inputSchema` cannot fall out of step with what it accepts — or
 * with what the endpoint behind it accepts.
 */
import { tool, type McpTool } from "@implementjs/kit/mcp";
import type { RequestEvent } from "@implementjs/kit/server";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { formatBytes, isAudio, isImage, isTextual } from "@/lib/domain/attachments";
import {
	CreateCommentBody,
	CreateIssueBody,
	CreateLabelBody,
	CreateWebhookBody,
	IssueStatusSchema,
	LinkPullRequestBody,
	TransferIssueBody,
	UpdateFeedbackBody,
	UpdateIssueBody,
	UpdateWebhookBody,
} from "@/lib/domain/schemas";
import { toolMedia, toolText, type ToolResult } from "./results.server";

/**
 * How much of an attachment may be inlined into a tool result.
 *
 * Uploads go up to 100MB, and base64 adds a third on top — a video pasted into
 * a comment would blow up the model's context long before it was useful. Files
 * over this are refused with their size, so the model knows the file exists and
 * why it did not get it.
 */
const MAX_INLINE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** `image/png; charset=…` → `image/png`. */
function baseType(contentType: string): string {
	return contentType.toLowerCase().split(";")[0]?.trim() ?? "application/octet-stream";
}

/**
 * An attachment's bytes, as something the model can actually take in.
 *
 * An image comes back as an `image` block rather than as base64 inside text —
 * that block type is the whole point, since it is what makes a screenshot on an
 * issue something the model can look at. Text files come back as their
 * characters. Anything else has no representation a model can read, so it is a
 * failure that says so rather than a wall of base64.
 */
async function attachmentBytes(response: Response): Promise<ToolResult> {
	const contentType = baseType(response.headers.get("content-type") ?? "");
	const filename = filenameFrom(response.headers.get("content-disposition"));

	const declared = Number(response.headers.get("content-length") ?? "");
	if (Number.isFinite(declared) && declared > MAX_INLINE_ATTACHMENT_BYTES) {
		return tooLarge(declared);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength > MAX_INLINE_ATTACHMENT_BYTES) return tooLarge(bytes.byteLength);

	if (isImage(contentType)) {
		return toolMedia("image", bytes.toString("base64"), contentType, filename);
	}
	if (isAudio(contentType)) {
		return toolMedia("audio", bytes.toString("base64"), contentType, filename);
	}
	if (isTextual(contentType)) {
		return toolText(`${filename}\n\n${bytes.toString("utf8")}`);
	}
	return tool.failure(
		`${filename} is ${contentType}, which cannot be read as text or shown as an image. Its metadata is on the issue or comment it hangs off.`,
	);
}

function tooLarge(size: number): ToolResult {
	return tool.failure(
		`That attachment is ${formatBytes(size)}; only files up to ${formatBytes(MAX_INLINE_ATTACHMENT_BYTES)} can be read this way.`,
	);
}

/** The original name, which the download route puts in `content-disposition`. */
function filenameFrom(disposition: string | null): string {
	const match = disposition === null ? null : /filename="([^"]*)"/.exec(disposition);
	return match?.[1] === undefined || match[1] === "" ? "attachment" : match[1];
}

/**
 * The workspace argument every scoped tool carries.
 *
 * Optional on purpose: an agent that can reach exactly one workspace should not
 * have to name it, and one that can reach several is told so by the error. It
 * has to be *declared*, though — kit validates a call's arguments against this
 * schema and hands `handle` the result, so an undeclared `workspace` would be
 * dropped on the way in.
 */
const workspaceArg = {
	workspace: v.optional(
		v.pipe(
			v.string(),
			v.description(
				"Workspace slug. Omit if you can only reach one; call list_workspaces to see them.",
			),
		),
	),
};

const identifier = v.pipe(
	v.string(),
	v.trim(),
	v.toUpperCase(),
	v.description('Issue identifier such as "ENG-42".'),
);

const webhookId = v.pipe(v.string(), v.description("Webhook id, from list_webhooks."));

/** `?a=1&a=2` for arrays, and omitting anything blank. */
function queryString(params: Record<string, unknown>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		// Consumed by the tool to choose the workspace; not a filter.
		if (key === "workspace") continue;
		if (value === undefined || value === null || value === "") continue;
		if (Array.isArray(value)) {
			for (const entry of value) search.append(key, String(entry));
		} else {
			search.append(key, String(value));
		}
	}
	const query = search.toString();
	return query === "" ? "" : `?${query}`;
}

function withoutWorkspace(args: Record<string, unknown>): Record<string, unknown> {
	const { workspace: _ignored, ...rest } = args;
	return rest;
}

/** An identifier or id, as one path segment. */
function segment(value: unknown): string {
	return encodeURIComponent(String(value));
}

/**
 * One call back through the app's own HTTP API, as the tool's answer.
 *
 * Dispatched through the API rather than by reaching into the database. It
 * costs a local round trip and buys one implementation of every rule:
 * permissions, the never-admin cap, webhook events, and the notifications a
 * write is supposed to produce.
 */
async function callApi(
	event: RequestEvent,
	method: string,
	path: string,
	body?: unknown,
): Promise<unknown> {
	const response = await apiFetch(event, method, path, body);
	if (response === null) return tool.failure("Could not reach the API");

	// A failure is JSON whatever the endpoint normally answers with, so it is
	// read the same way before anything else looks at the body.
	if (!response.ok) return await failureFrom(response);

	return success(await jsonFrom(response));
}

/**
 * An endpoint's JSON as both prose and data.
 *
 * Returning the value alone would make it a `text` block and nothing else,
 * which is what a client that reads `structuredContent` — typed fields rather
 * than JSON it has to parse back out of a string — would find missing. The
 * text carries the same JSON for the clients that only read `content`.
 *
 * `structuredContent` is an object in the protocol, so a list is wrapped in
 * one rather than dropped.
 */
function success(data: unknown): ToolResult {
	return tool.structured(isPlainObject(data) ? data : { result: data }, {
		type: "text",
		text: JSON.stringify(data, null, 2),
	});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A response body as data, falling back to its text when it is not JSON. */
async function jsonFrom(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		// Leave it as text; a non-JSON body is still worth showing the model.
		return text;
	}
}

/** An error response, as the message the endpoint put in it. */
async function failureFrom(response: Response): Promise<ToolResult> {
	const parsed = await jsonFrom(response);
	const message =
		typeof parsed === "object" && parsed !== null && "message" in parsed
			? String((parsed as { message: unknown }).message)
			: `Request failed with ${response.status}`;
	return tool.failure(`${message} (HTTP ${response.status})`);
}

/**
 * Which workspace a scoped tool acts in.
 *
 * A grant covers every workspace its approver belongs to, so the model has to
 * say — unless there is only one, which is the usual case and not worth making
 * it look up. Anything else is a tool error naming the options, so the model can
 * retry with one rather than guess.
 */
async function workspaceFor(
	event: RequestEvent,
	asked: string | undefined,
): Promise<string | ToolResult> {
	const named = asked === undefined ? "" : asked.trim();
	if (named !== "") return named;

	const response = await apiFetch(event, "GET", "/api/v1/workspaces");
	if (response === null) return tool.failure("Could not reach the API");

	const workspaces = (await response.json()) as { slug: string; name: string }[];
	if (workspaces.length === 1) return workspaces[0]!.slug;
	if (workspaces.length === 0) {
		return tool.failure(
			"You cannot reach any workspace. The person who authorized you is not a member of one.",
		);
	}
	const options = workspaces.map((entry) => `${entry.slug} (${entry.name})`).join(", ");
	return tool.failure(`Pass \`workspace\` — you can act in: ${options}`);
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

/**
 * A tool that acts inside a workspace.
 *
 * Wraps `handle` so it is only reached with a slug in hand: the workspace
 * either came in as an argument or was the agent's only one, and anything else
 * is the failure `workspaceFor` wrote, handed straight back to the model.
 *
 * `readOnlyHint` and `destructiveHint` are advisory — the spec tells clients not
 * to trust annotations from an untrusted server — but they let a harness that
 * does trust us show writes differently, and cost nothing to be honest about.
 */
function scoped<S extends v.GenericSchema<Record<string, unknown>>>(definition: {
	name: string;
	title: string;
	description: string;
	input: S;
	readOnly: boolean;
	destructive?: boolean;
	handle: (context: {
		input: v.InferOutput<S>;
		event: RequestEvent;
		slug: string;
	}) => Promise<unknown>;
}): McpTool {
	return tool({
		name: definition.name,
		title: definition.title,
		description: definition.description,
		input: definition.input,
		annotations: {
			readOnlyHint: definition.readOnly,
			destructiveHint: definition.destructive ?? false,
		},
		handle: async ({ input, event }) => {
			const slug = await workspaceFor(event, input.workspace as string | undefined);
			if (typeof slug !== "string") return slug;
			return await definition.handle({ input, event, slug });
		},
	});
}

/**
 * A tool's `inputSchema`, converted here rather than by kit.
 *
 * Kit builds `tools/list` schemas by `await import`ing the valibot converter
 * under a variable specifier, deliberately so no bundler follows it. Nothing
 * then puts the package in the deployed function, the import throws, and the
 * `catch` turns that into "listing it as unconstrained" — every tool advertised
 * as a bare `{"type":"object"}`, with not one argument visible to the model.
 * Locally it always works, because dev installs the converter either way.
 *
 * Importing it at the top of this file is what makes it survive the build, and
 * `inputJsonSchema` takes precedence over `input`, so kit never reaches the
 * dynamic path. The conversion is the same call kit would have made.
 */
function withSchema(entry: McpTool): McpTool {
	if (entry.input === undefined) return entry;
	// The converter's own `JsonSchema` is a closed shape; kit's is an open
	// record, and it is the one this has to satisfy.
	const schema = toJsonSchema(entry.input as v.GenericSchema, {
		errorMode: "ignore",
	}) as Record<string, unknown>;
	return { ...entry, inputJsonSchema: async () => schema };
}

export const MCP_TOOLS: McpTool[] = [
	tool({
		name: "whoami",
		title: "Who am I",
		description:
			"Identify yourself: the agent account you act as, the workspace you are connected to, and the person whose access you borrow. Call this first if you are unsure what you can see.",
		annotations: { readOnlyHint: true },
		input: v.object({}),
		handle: async ({ event }) => await callApi(event, "GET", "/api/v1/me"),
	}),
	tool({
		name: "list_workspaces",
		title: "List workspaces",
		description:
			"The workspaces you can act in. You reach them through the person who authorized you, so this is exactly what they belong to. Pass one of these slugs as `workspace` when a tool needs it.",
		annotations: { readOnlyHint: true },
		input: v.object({}),
		handle: async ({ event }) => await callApi(event, "GET", "/api/v1/workspaces"),
	}),
	scoped({
		name: "list_issues",
		title: "List issues",
		description:
			"List issues in the workspace, newest first. Every filter is optional and they combine. Use `q` for free text over titles and descriptions; use it rather than listing everything and filtering yourself.",
		readOnly: true,
		input: v.object({
			team: v.optional(v.pipe(v.string(), v.description('Team key, e.g. "ENG".'))),
			status: v.optional(v.array(IssueStatusSchema)),
			priority: v.optional(v.array(v.picklist(["none", "low", "medium", "high", "urgent"]))),
			assignee: v.optional(
				v.pipe(v.string(), v.description('A user id, or "none" for unassigned issues.')),
			),
			q: v.optional(
				v.pipe(v.string(), v.description("Free-text search over title and description.")),
			),
			repository: v.optional(v.pipe(v.string(), v.description("A linked repository id."))),
			...workspaceArg,
		}),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/issues${queryString(input)}`),
	}),
	scoped({
		name: "get_issue",
		title: "Get an issue",
		description:
			"Fetch one issue in full by its identifier, including description, labels, assignee, and the files attached to it. Attachments come back as metadata — pass an `id` from `attachments` to read_attachment to see the file itself.",
		readOnly: true,
		input: v.object({ identifier, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}`),
	}),
	scoped({
		name: "create_issue",
		title: "Create an issue",
		description:
			"File a new issue. `teamKey` decides the identifier prefix — call list_teams first if you do not know it. The issue is attributed to you, not to the person who authorized you.",
		readOnly: false,
		input: v.object({ ...CreateIssueBody.entries, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "POST", `/api/v1/workspaces/${slug}/issues`, withoutWorkspace(input)),
	}),
	scoped({
		name: "update_issue",
		title: "Update an issue",
		description:
			"Change an existing issue. Only the fields you pass are touched. Moving an issue between teams reallocates its number, so its identifier changes — the response carries the new one.",
		readOnly: false,
		input: v.object({ identifier, changes: UpdateIssueBody, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"PATCH",
				`/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}`,
				input.changes,
			),
	}),
	scoped({
		name: "delete_issue",
		title: "Delete an issue",
		description: "Permanently delete an issue and its comments. This cannot be undone.",
		readOnly: false,
		destructive: true,
		input: v.object({ identifier, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"DELETE",
				`/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}`,
			),
	}),
	scoped({
		name: "transfer_issue",
		title: "Transfer an issue",
		description:
			"Move an issue to another workspace. You must be connected to the destination too, so this usually fails unless both were granted to you.",
		readOnly: false,
		input: v.object({ identifier, ...TransferIssueBody.entries, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"POST",
				`/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}/transfer`,
				{ workspaceSlug: input.workspaceSlug, teamKey: input.teamKey },
			),
	}),
	scoped({
		name: "list_comments",
		title: "List comments",
		description:
			"Read the comment thread on an issue, oldest first. A comment's `attachments` are metadata; pass an `id` from one to read_attachment to see the file itself.",
		readOnly: true,
		input: v.object({ identifier, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"GET",
				`/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}/comments`,
			),
	}),
	scoped({
		name: "read_attachment",
		title: "Read an attachment",
		description:
			"Read the file behind an attachment id, rather than its metadata. Images come back as pictures you can look at, text files as their contents. Ids come from the `attachments` on an issue or a comment.",
		readOnly: true,
		input: v.object({
			id: v.pipe(
				v.string(),
				v.description("Attachment id, from `attachments` on an issue or a comment."),
			),
			...workspaceArg,
		}),
		// The one endpoint that answers bytes: reading those as text would
		// corrupt them, so this tool shapes its own result.
		handle: async ({ input, event, slug }) => {
			const response = await apiFetch(
				event,
				"GET",
				`/api/v1/workspaces/${slug}/attachments/${segment(input.id)}`,
			);
			if (response === null) return tool.failure("Could not reach the API");
			if (!response.ok) return await failureFrom(response);
			return await attachmentBytes(response);
		},
	}),
	scoped({
		name: "comment_on_issue",
		title: "Comment on an issue",
		description:
			"Add a comment to an issue. It appears under your own name and notifies the issue's assignee and author.",
		readOnly: false,
		input: v.object({ identifier, ...CreateCommentBody.entries, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"POST",
				`/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}/comments`,
				{ body: input.body, attachmentIds: input.attachmentIds },
			),
	}),
	scoped({
		name: "link_pull_request",
		title: "Link a pull request",
		description:
			"Attach a pull request to an issue, so the work and the ticket point at each other. Accepts a full URL, `owner/name#12`, or `#12` when the issue is already scoped to a repository. One PR per issue.",
		readOnly: false,
		input: v.object({ identifier, ...LinkPullRequestBody.entries, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"POST",
				`/api/v1/workspaces/${slug}/issues/${segment(input.identifier)}/pull-request`,
				{ reference: input.reference },
			),
	}),
	scoped({
		name: "list_repositories",
		title: "List repositories",
		description:
			"Repositories linked to the workspace, with their ids — needed to scope an issue with `repositoryId`, and to reference files.",
		readOnly: true,
		input: v.object({ ...workspaceArg }),
		handle: async ({ event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/repositories`),
	}),
	scoped({
		name: "list_teams",
		title: "List teams",
		description:
			"List the workspace's teams and their keys. A team key is required to create an issue.",
		readOnly: true,
		input: v.object({ ...workspaceArg }),
		handle: async ({ event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/teams`),
	}),
	scoped({
		name: "list_labels",
		title: "List labels",
		description: "List the workspace's labels with their ids, for use with `labelIds`.",
		readOnly: true,
		input: v.object({ ...workspaceArg }),
		handle: async ({ event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/labels`),
	}),
	scoped({
		name: "create_label",
		title: "Create a label",
		description: "Add a label to the workspace. Colour is a hex string such as #5e6ad2.",
		readOnly: false,
		input: v.object({ ...CreateLabelBody.entries, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "POST", `/api/v1/workspaces/${slug}/labels`, withoutWorkspace(input)),
	}),
	scoped({
		name: "list_members",
		title: "List members",
		description:
			"List who is in the workspace, with their user ids — needed to assign an issue. Agents appear here too.",
		readOnly: true,
		input: v.object({ ...workspaceArg }),
		handle: async ({ event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/members`),
	}),
	scoped({
		name: "get_workspace",
		title: "Get the workspace",
		description: "Details of the workspace you are connected to, including its feedback settings.",
		readOnly: true,
		input: v.object({ ...workspaceArg }),
		handle: async ({ event, slug }) => await callApi(event, "GET", `/api/v1/workspaces/${slug}`),
	}),
	scoped({
		name: "list_webhooks",
		title: "List webhooks",
		description:
			"The workspace's outgoing webhooks, with the events each listens for and how it is currently faring. Signing secrets are not included — they are shown once, when the webhook is created.",
		readOnly: true,
		input: v.object({ ...workspaceArg }),
		handle: async ({ event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/webhooks`),
	}),
	scoped({
		name: "create_webhook",
		title: "Create a webhook",
		description:
			'Subscribe an endpoint to workspace events — this is how you get told about an issue rather than polling for it. Use `filter` to narrow what actually arrives, and the "text" format for a receiver that takes freeform text, such as a Claude Code routine trigger. The response carries the signing secret, and it is the only time it is readable: save it before you do anything else.',
		readOnly: false,
		input: v.object({ ...CreateWebhookBody.entries, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "POST", `/api/v1/workspaces/${slug}/webhooks`, withoutWorkspace(input)),
	}),
	scoped({
		name: "update_webhook",
		title: "Update a webhook",
		description:
			"Change a webhook: what it listens for, its conditions, its headers, its body format, or whether it is enabled at all. Only the fields you pass are touched. The URL is not among them — the secret was issued against it, so pointing somewhere else means a new webhook.",
		readOnly: false,
		input: v.object({ id: webhookId, changes: UpdateWebhookBody, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"PATCH",
				`/api/v1/workspaces/${slug}/webhooks/${segment(input.id)}`,
				input.changes,
			),
	}),
	scoped({
		name: "delete_webhook",
		title: "Delete a webhook",
		description:
			"Remove a webhook and stop its deliveries for good. To pause one instead, update it with `enabled: false` — that keeps the endpoint and its secret.",
		readOnly: false,
		destructive: true,
		input: v.object({ id: webhookId, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "DELETE", `/api/v1/workspaces/${slug}/webhooks/${segment(input.id)}`),
	}),
	scoped({
		name: "test_webhook",
		title: "Send a test delivery",
		description:
			"Send a real, signed delivery with a synthetic payload, and wait for the result. Conditions are skipped, since there is no issue for them to match against. Use this to confirm a receiver you just pointed a webhook at actually answers.",
		readOnly: false,
		input: v.object({ id: webhookId, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "POST", `/api/v1/workspaces/${slug}/webhooks/${segment(input.id)}/test`),
	}),
	scoped({
		name: "list_webhook_deliveries",
		title: "List a webhook's deliveries",
		description:
			"The delivery log for one webhook, newest first — where you look when a subscription has gone quiet. Each row carries the event, the endpoint's status code, and the error if there was one.",
		readOnly: true,
		input: v.object({
			id: webhookId,
			limit: v.optional(
				v.pipe(
					v.number(),
					v.integer(),
					v.minValue(1),
					v.maxValue(100),
					v.description("How many deliveries to return. Defaults to 25."),
				),
			),
			...workspaceArg,
		}),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"GET",
				`/api/v1/workspaces/${slug}/webhooks/${segment(input.id)}/deliveries${queryString({
					limit: input.limit,
				})}`,
			),
	}),
	scoped({
		name: "list_feedback",
		title: "List user feedback",
		description:
			"List incoming user feedback awaiting triage. Filter by status, or search with `q`.",
		readOnly: true,
		input: v.object({
			status: v.optional(
				v.array(v.picklist(["new", "planned", "in_progress", "done", "declined"])),
			),
			q: v.optional(v.string()),
			...workspaceArg,
		}),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/user-feedback${queryString(input)}`),
	}),
	scoped({
		name: "get_feedback",
		title: "Get one piece of feedback",
		description: "Fetch a single piece of user feedback by its id, with its submitter and labels.",
		readOnly: true,
		input: v.object({ id: v.string(), ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(event, "GET", `/api/v1/workspaces/${slug}/user-feedback/${segment(input.id)}`),
	}),
	scoped({
		name: "update_feedback",
		title: "Triage feedback",
		description:
			"Change a piece of feedback — its status, labels, or whether it is visible on the public board.",
		readOnly: false,
		input: v.object({ id: v.string(), changes: UpdateFeedbackBody, ...workspaceArg }),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"PATCH",
				`/api/v1/workspaces/${slug}/user-feedback/${segment(input.id)}`,
				input.changes,
			),
	}),
	scoped({
		name: "convert_feedback_to_issue",
		title: "Convert feedback to an issue",
		description:
			"Turn a piece of user feedback into a tracked issue. Idempotent: feedback already converted returns the issue it became.",
		readOnly: false,
		input: v.object({
			id: v.string(),
			teamKey: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6)),
			title: v.optional(v.string()),
			...workspaceArg,
		}),
		handle: async ({ input, event, slug }) =>
			await callApi(
				event,
				"POST",
				`/api/v1/workspaces/${slug}/user-feedback/${segment(input.id)}/convert`,
				{ teamKey: input.teamKey, title: input.title },
			),
	}),
	tool({
		name: "list_notifications",
		title: "List your notifications",
		description:
			"Your own inbox as an agent — things addressed to you, such as an issue assigned to you.",
		annotations: { readOnlyHint: true },
		input: v.object({ unread: v.optional(v.boolean()) }),
		handle: async ({ input, event }) =>
			await callApi(event, "GET", `/api/v1/notifications${queryString({ unread: input.unread })}`),
	}),
].map(withSchema);
