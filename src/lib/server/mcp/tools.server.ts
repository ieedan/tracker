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
 * Schemas are the app's own valibot schemas turned into JSON Schema, so a
 * tool's `inputSchema` cannot fall out of step with what the endpoint accepts.
 */
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import {
	CreateCommentBody,
	CreateIssueBody,
	CreateLabelBody,
	LinkPullRequestBody,
	TransferIssueBody,
	UpdateFeedbackBody,
	UpdateIssueBody,
} from "@/lib/domain/schemas";

export interface McpTool {
	name: string;
	title: string;
	description: string;
	input: v.GenericSchema;
	/** Read-only tools are advertised as such so a client can surface the difference. */
	readOnly: boolean;
	/**
	 * Whether this tool acts inside a workspace.
	 *
	 * A grant is not scoped to one, so scoped tools take a `workspace` argument.
	 * The endpoint fills it in when the agent can only reach one, which is the
	 * common case and saves the model a lookup it would usually get right anyway.
	 */
	scoped: boolean;
	request: (
		args: Record<string, unknown>,
		slug: string,
	) => { method: string; path: string; body?: unknown };
}

/**
 * The workspace argument every scoped tool carries.
 *
 * Optional on purpose: an agent that can reach exactly one workspace should not
 * have to name it, and one that can reach several is told so by the error.
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

/** `?a=1&a=2` for arrays, and omitting anything blank. */
function queryString(params: Record<string, unknown>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		// Consumed by the endpoint to choose the workspace; not a filter.
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

export const MCP_TOOLS: McpTool[] = [
	{
		name: "whoami",
		title: "Who am I",
		description:
			"Identify yourself: the agent account you act as, the workspace you are connected to, and the person whose access you borrow. Call this first if you are unsure what you can see.",
		readOnly: true,
		scoped: false,
		input: v.object({}),
		request: () => ({ method: "GET", path: "/api/v1/me" }),
	},
	{
		name: "list_workspaces",
		title: "List workspaces",
		description:
			"The workspaces you can act in. You reach them through the person who authorized you, so this is exactly what they belong to. Pass one of these slugs as `workspace` when a tool needs it.",
		readOnly: true,
		scoped: false,
		input: v.object({}),
		request: () => ({ method: "GET", path: "/api/v1/workspaces" }),
	},
	{
		name: "list_issues",
		title: "List issues",
		description:
			"List issues in the workspace, newest first. Every filter is optional and they combine. Use `q` for free text over titles and descriptions; use it rather than listing everything and filtering yourself.",
		readOnly: true,
		scoped: true,
		input: v.object({
			team: v.optional(v.pipe(v.string(), v.description('Team key, e.g. "ENG".'))),
			status: v.optional(
				v.array(v.picklist(["backlog", "todo", "in_progress", "done", "canceled"])),
			),
			priority: v.optional(v.array(v.picklist(["none", "low", "medium", "high", "urgent"]))),
			assignee: v.optional(
				v.pipe(v.string(), v.description('A user id, or "none" for unassigned issues.')),
			),
			q: v.optional(
				v.pipe(v.string(), v.description("Free-text search over title and description.")),
			),
			repository: v.optional(v.pipe(v.string(), v.description("A linked repository id."))),
		}),
		request: (args, slug) => ({
			method: "GET",
			path: `/api/v1/workspaces/${slug}/issues${queryString(args)}`,
		}),
	},
	{
		name: "get_issue",
		title: "Get an issue",
		description:
			"Fetch one issue in full by its identifier, including description, labels, assignee and attachments.",
		readOnly: true,
		scoped: true,
		input: v.object({ identifier, ...workspaceArg }),
		request: (args, slug) => ({
			method: "GET",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}`,
		}),
	},
	{
		name: "create_issue",
		title: "Create an issue",
		description:
			"File a new issue. `teamKey` decides the identifier prefix — call list_teams first if you do not know it. The issue is attributed to you, not to the person who authorized you.",
		readOnly: false,
		scoped: true,
		input: v.object({ ...CreateIssueBody.entries, ...workspaceArg }),
		request: (args, slug) => ({
			method: "POST",
			path: `/api/v1/workspaces/${slug}/issues`,
			body: withoutWorkspace(args),
		}),
	},
	{
		name: "update_issue",
		title: "Update an issue",
		description:
			"Change an existing issue. Only the fields you pass are touched. Moving an issue between teams reallocates its number, so its identifier changes — the response carries the new one.",
		readOnly: false,
		scoped: true,
		input: v.object({ identifier, changes: UpdateIssueBody, ...workspaceArg }),
		request: (args, slug) => ({
			method: "PATCH",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}`,
			body: args.changes,
		}),
	},
	{
		name: "delete_issue",
		title: "Delete an issue",
		description: "Permanently delete an issue and its comments. This cannot be undone.",
		readOnly: false,
		scoped: true,
		input: v.object({ identifier, ...workspaceArg }),
		request: (args, slug) => ({
			method: "DELETE",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}`,
		}),
	},
	{
		name: "transfer_issue",
		title: "Transfer an issue",
		description:
			"Move an issue to another workspace. You must be connected to the destination too, so this usually fails unless both were granted to you.",
		readOnly: false,
		scoped: true,
		input: v.object({ identifier, ...TransferIssueBody.entries, ...workspaceArg }),
		request: (args, slug) => ({
			method: "POST",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}/transfer`,
			body: { workspaceSlug: args.workspaceSlug, teamKey: args.teamKey },
		}),
	},
	{
		name: "list_comments",
		title: "List comments",
		description: "Read the comment thread on an issue, oldest first.",
		readOnly: true,
		scoped: true,
		input: v.object({ identifier, ...workspaceArg }),
		request: (args, slug) => ({
			method: "GET",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}/comments`,
		}),
	},
	{
		name: "comment_on_issue",
		title: "Comment on an issue",
		description:
			"Add a comment to an issue. It appears under your own name and notifies the issue's assignee and author.",
		readOnly: false,
		scoped: true,
		input: v.object({ identifier, ...CreateCommentBody.entries, ...workspaceArg }),
		request: (args, slug) => ({
			method: "POST",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}/comments`,
			body: { body: args.body, attachmentIds: args.attachmentIds },
		}),
	},
	{
		name: "link_pull_request",
		title: "Link a pull request",
		description:
			"Attach a pull request to an issue, so the work and the ticket point at each other. Accepts a full URL, `owner/name#12`, or `#12` when the issue is already scoped to a repository. One PR per issue.",
		readOnly: false,
		scoped: true,
		input: v.object({ identifier, ...LinkPullRequestBody.entries, ...workspaceArg }),
		request: (args, slug) => ({
			method: "POST",
			path: `/api/v1/workspaces/${slug}/issues/${encodeURIComponent(String(args.identifier))}/pull-request`,
			body: { reference: args.reference },
		}),
	},
	{
		name: "list_repositories",
		title: "List repositories",
		description:
			"Repositories linked to the workspace, with their ids — needed to scope an issue with `repositoryId`, and to reference files.",
		readOnly: true,
		scoped: true,
		input: v.object({ ...workspaceArg }),
		request: (_args, slug) => ({
			method: "GET",
			path: `/api/v1/workspaces/${slug}/repositories`,
		}),
	},
	{
		name: "list_teams",
		title: "List teams",
		description:
			"List the workspace's teams and their keys. A team key is required to create an issue.",
		readOnly: true,
		scoped: true,
		input: v.object({}),
		request: (_args, slug) => ({ method: "GET", path: `/api/v1/workspaces/${slug}/teams` }),
	},
	{
		name: "list_labels",
		title: "List labels",
		description: "List the workspace's labels with their ids, for use with `labelIds`.",
		readOnly: true,
		scoped: true,
		input: v.object({}),
		request: (_args, slug) => ({ method: "GET", path: `/api/v1/workspaces/${slug}/labels` }),
	},
	{
		name: "create_label",
		title: "Create a label",
		description: "Add a label to the workspace. Colour is a hex string such as #5e6ad2.",
		readOnly: false,
		scoped: true,
		input: v.object({ ...CreateLabelBody.entries, ...workspaceArg }),
		request: (args, slug) => ({
			method: "POST",
			path: `/api/v1/workspaces/${slug}/labels`,
			body: withoutWorkspace(args),
		}),
	},
	{
		name: "list_members",
		title: "List members",
		description:
			"List who is in the workspace, with their user ids — needed to assign an issue. Agents appear here too.",
		readOnly: true,
		scoped: true,
		input: v.object({}),
		request: (_args, slug) => ({ method: "GET", path: `/api/v1/workspaces/${slug}/members` }),
	},
	{
		name: "get_workspace",
		title: "Get the workspace",
		description: "Details of the workspace you are connected to, including its feedback settings.",
		readOnly: true,
		scoped: true,
		input: v.object({}),
		request: (_args, slug) => ({ method: "GET", path: `/api/v1/workspaces/${slug}` }),
	},
	{
		name: "list_feedback",
		title: "List user feedback",
		description:
			"List incoming user feedback awaiting triage. Filter by status, or search with `q`.",
		readOnly: true,
		scoped: true,
		input: v.object({
			status: v.optional(
				v.array(v.picklist(["new", "planned", "in_progress", "done", "declined"])),
			),
			q: v.optional(v.string()),
		}),
		request: (args, slug) => ({
			method: "GET",
			path: `/api/v1/workspaces/${slug}/user-feedback${queryString(args)}`,
		}),
	},
	{
		name: "get_feedback",
		title: "Get one piece of feedback",
		description: "Fetch a single piece of user feedback by its id, with its submitter and labels.",
		readOnly: true,
		scoped: true,
		input: v.object({ id: v.string(), ...workspaceArg }),
		request: (args, slug) => ({
			method: "GET",
			path: `/api/v1/workspaces/${slug}/user-feedback/${encodeURIComponent(String(args.id))}`,
		}),
	},
	{
		name: "update_feedback",
		title: "Triage feedback",
		description:
			"Change a piece of feedback — its status, labels, or whether it is visible on the public board.",
		readOnly: false,
		scoped: true,
		input: v.object({ id: v.string(), changes: UpdateFeedbackBody, ...workspaceArg }),
		request: (args, slug) => ({
			method: "PATCH",
			path: `/api/v1/workspaces/${slug}/user-feedback/${encodeURIComponent(String(args.id))}`,
			body: args.changes,
		}),
	},
	{
		name: "convert_feedback_to_issue",
		title: "Convert feedback to an issue",
		description:
			"Turn a piece of user feedback into a tracked issue. Idempotent: feedback already converted returns the issue it became.",
		readOnly: false,
		scoped: true,
		input: v.object({
			id: v.string(),
			teamKey: v.pipe(v.string(), v.trim(), v.toUpperCase(), v.maxLength(6)),
			title: v.optional(v.string()),
		}),
		request: (args, slug) => ({
			method: "POST",
			path: `/api/v1/workspaces/${slug}/user-feedback/${encodeURIComponent(String(args.id))}/convert`,
			body: { teamKey: args.teamKey, title: args.title },
		}),
	},
	{
		name: "list_notifications",
		title: "List your notifications",
		description:
			"Your own inbox as an agent — things addressed to you, such as an issue assigned to you.",
		readOnly: true,
		scoped: false,
		input: v.object({ unread: v.optional(v.boolean()) }),
		request: (args) => ({
			method: "GET",
			path: `/api/v1/notifications${queryString({ unread: args.unread })}`,
		}),
	},
];

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));

/**
 * The `tools/list` payload.
 *
 * `annotations.readOnlyHint` is advisory — the spec tells clients not to trust
 * annotations from an untrusted server — but it lets a harness that does trust
 * us show writes differently, and costs nothing to be honest about.
 */
export function describeTools(): Record<string, unknown>[] {
	return MCP_TOOLS.map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: inputSchemaFor(tool),
		annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.name === "delete_issue" },
	}));
}

function inputSchemaFor(tool: McpTool): Record<string, unknown> {
	// `ignore` keeps a schema the converter cannot express from failing the whole
	// listing — the tool still appears, just with a looser shape.
	const schema = toJsonSchema(tool.input, { errorMode: "ignore" }) as Record<string, unknown>;
	// MCP requires an object schema; valibot emits no `type` for an empty object.
	return { type: "object", properties: {}, ...schema };
}
