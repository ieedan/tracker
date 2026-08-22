import { env } from "@/lib/env.public";
import { PRIORITY_LABELS, WEBHOOK_EVENTS } from "@/lib/types";

/**
 * The OpenAPI 3.1 description of `/api/v1`, served at `/api/v1/openapi.json`.
 *
 * It is written by hand rather than derived from the zod schemas: the request
 * shapes and the document would have to be kept in step either way, and a
 * hand-written document can say things a generated one cannot — what an
 * identifier means, why a workspace answers 404 instead of 403.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = {
	description: "Something went wrong. The body carries a human-readable message.",
	content: { "application/json": { schema: ref("Error") } },
};

const workspaceParam = {
	name: "workspace",
	in: "path",
	required: true,
	description: "The GitHub owner login the workspace mirrors, e.g. `acme`.",
	schema: { type: "string" },
};

const identifierParam = {
	name: "identifier",
	in: "path",
	required: true,
	description: "The issue's human-readable identifier, e.g. `api-12` or `ACME-3`.",
	schema: { type: "string" },
};

const commonErrors = {
	"400": errorResponse,
	"401": { ...errorResponse, description: "No session cookie and no valid API key." },
	"404": {
		...errorResponse,
		description:
			"No such resource — also the answer when the caller is not a member of the workspace, so a private organization's existence is not leaked.",
	},
};

export function openapiDocument(): unknown {
	return {
		openapi: "3.1.0",
		info: {
			title: `${env.PUBLIC_APP_NAME} API`,
			version: "1.0.0",
			description: [
				"Issue tracking scoped to GitHub owners.",
				"",
				"Every workspace mirrors a GitHub user or organization, and membership is GitHub's:",
				"you can reach a workspace exactly when GitHub says you belong to its owner.",
				"Issues may be scoped to one of that owner's repos, or left unscoped.",
				"",
				"Authenticate with an API key (`Authorization: Bearer trk_…` or `X-API-Key: trk_…`),",
				"which you can mint under Settings → API keys. Browser sessions work too, so the",
				"app itself uses this same API.",
			].join("\n"),
			license: { name: "MIT", identifier: "MIT" },
		},
		servers: [{ url: `${env.PUBLIC_APP_URL}/api/v1` }],
		security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
		tags: [
			{
				name: "Workspaces",
				description:
					"A workspace mirrors one GitHub user or organization, along with the repos issues can be scoped to.",
			},
			{
				name: "Issues",
				description:
					"Issues belong to a workspace and may be scoped to one of its repos or left unscoped.",
			},
			{ name: "Comments", description: "Markdown discussion on an issue." },
			{
				name: "Statuses",
				description:
					"The workflow states of a workspace, seeded on creation and editable afterwards.",
			},
			{ name: "Labels", description: "Workspace-wide labels that issues can carry." },
			{ name: "Files", description: "Uploads, stored in object storage and served by URL." },
			{
				name: "Webhooks",
				description: "Signed outbound notifications when things change in a workspace.",
			},
			{
				name: "Realtime",
				description: "A live stream of the same events, for clients that stay connected.",
			},
		],
		paths: {
			"/me": {
				get: {
					tags: ["Workspaces"],
					summary: "The authenticated user and their workspaces",
					operationId: "getMe",
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["user", "workspaces"],
										properties: {
											user: ref("User"),
											workspaces: { type: "array", items: ref("Workspace") },
										},
									},
								},
							},
						},
						"401": commonErrors["401"],
					},
				},
			},
			"/workspaces": {
				get: {
					tags: ["Workspaces"],
					summary: "List workspaces the caller belongs to",
					operationId: "listWorkspaces",
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("Workspace") } },
									},
								},
							},
						},
						"401": commonErrors["401"],
					},
				},
			},
			"/workspaces/{workspace}": {
				get: {
					tags: ["Workspaces"],
					summary: "Get one workspace",
					operationId: "getWorkspace",
					parameters: [workspaceParam],
					responses: {
						"200": { description: "OK", content: { "application/json": { schema: ref("Workspace") } } },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/issues": {
				get: {
					tags: ["Issues"],
					summary: "List issues",
					description:
						"Ordered by the workspace's manual ordering. Paginate by passing the last item's `position` back as `cursor`.",
					operationId: "listIssues",
					parameters: [
						workspaceParam,
						{
							name: "status",
							in: "query",
							description: "Status ids. Repeat the parameter or comma-separate.",
							schema: { type: "string" },
						},
						{ name: "assignee", in: "query", description: "User ids.", schema: { type: "string" } },
						{ name: "label", in: "query", description: "Label ids.", schema: { type: "string" } },
						{
							name: "priority",
							in: "query",
							description: `Priority values. ${Object.entries(PRIORITY_LABELS)
								.map(([value, label]) => `${value} = ${label}`)
								.join(", ")}.`,
							schema: { type: "string" },
						},
						{
							name: "repo",
							in: "query",
							description:
								"Repo ids. Repeat the parameter or comma-separate. The literal `none` matches issues that are not scoped to a repo, and can be combined with real ids.",
							schema: { type: "string" },
						},
						{ name: "q", in: "query", description: "Matches title or identifier.", schema: { type: "string" } },
						{ name: "includeArchived", in: "query", schema: { type: "boolean" } },
						{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 250, default: 100 } },
						{ name: "cursor", in: "query", schema: { type: "string" } },
					],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items", "nextCursor"],
										properties: {
											items: { type: "array", items: ref("Issue") },
											nextCursor: { type: ["string", "null"] },
										},
									},
								},
							},
						},
						...commonErrors,
					},
				},
				post: {
					tags: ["Issues"],
					summary: "Create an issue",
					description:
						"The identifier is assigned from the repo's counter when `repoId` is set, and from the workspace prefix otherwise. It never changes afterwards, even if the issue moves between repos.",
					operationId: "createIssue",
					parameters: [workspaceParam],
					requestBody: {
						required: true,
						content: { "application/json": { schema: ref("CreateIssue") } },
					},
					responses: {
						"201": { description: "Created", content: { "application/json": { schema: ref("Issue") } } },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/issues/{identifier}": {
				get: {
					tags: ["Issues"],
					summary: "Get an issue",
					operationId: "getIssue",
					parameters: [workspaceParam, identifierParam],
					responses: {
						"200": { description: "OK", content: { "application/json": { schema: ref("Issue") } } },
						...commonErrors,
					},
				},
				patch: {
					tags: ["Issues"],
					summary: "Update an issue",
					operationId: "updateIssue",
					parameters: [workspaceParam, identifierParam],
					requestBody: {
						required: true,
						content: { "application/json": { schema: ref("UpdateIssue") } },
					},
					responses: {
						"200": { description: "OK", content: { "application/json": { schema: ref("Issue") } } },
						...commonErrors,
					},
				},
				delete: {
					tags: ["Issues"],
					summary: "Delete an issue",
					operationId: "deleteIssue",
					parameters: [workspaceParam, identifierParam],
					responses: { "204": { description: "Deleted" }, ...commonErrors },
				},
			},
			"/workspaces/{workspace}/issues/{identifier}/comments": {
				get: {
					tags: ["Comments"],
					summary: "List comments",
					operationId: "listComments",
					parameters: [workspaceParam, identifierParam],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("Comment") } },
									},
								},
							},
						},
						...commonErrors,
					},
				},
				post: {
					tags: ["Comments"],
					summary: "Add a comment",
					operationId: "createComment",
					parameters: [workspaceParam, identifierParam],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["body"],
									properties: { body: { type: "string", description: "Markdown." } },
								},
							},
						},
					},
					responses: {
						"201": { description: "Created", content: { "application/json": { schema: ref("Comment") } } },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/issues/{identifier}/comments/{commentId}": {
				delete: {
					tags: ["Comments"],
					summary: "Delete a comment",
					description: "Only the comment's author may delete it.",
					operationId: "deleteComment",
					parameters: [
						workspaceParam,
						identifierParam,
						{ name: "commentId", in: "path", required: true, schema: { type: "string" } },
					],
					responses: {
						"204": { description: "Deleted" },
						"403": { ...errorResponse, description: "The comment belongs to someone else." },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/repos": {
				get: {
					tags: ["Workspaces"],
					summary: "List the workspace's repos",
					description: "Mirrored from GitHub, refreshed at most every five minutes.",
					operationId: "listRepos",
					parameters: [workspaceParam],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("Repo") } },
									},
								},
							},
						},
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/members": {
				get: {
					tags: ["Workspaces"],
					summary: "List the people who appear on this workspace's issues",
					description:
						"Not a membership list — membership lives on GitHub and is not stored here. This is whoever has actually appeared on an issue as assignee or creator, which is what an assignee filter needs.",
					operationId: "listMembers",
					parameters: [workspaceParam],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("User") } },
									},
								},
							},
						},
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/statuses": {
				get: {
					tags: ["Statuses"],
					summary: "List statuses",
					operationId: "listStatuses",
					parameters: [workspaceParam],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("Status") } },
									},
								},
							},
						},
						...commonErrors,
					},
				},
				post: {
					tags: ["Statuses"],
					summary: "Create a status",
					operationId: "createStatus",
					parameters: [workspaceParam],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["name", "category", "color"],
									properties: {
										name: { type: "string" },
										category: ref("StatusCategory"),
										color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
									},
								},
							},
						},
					},
					responses: {
						"201": { description: "Created", content: { "application/json": { schema: ref("Status") } } },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/statuses/{statusId}": {
				patch: {
					tags: ["Statuses"],
					summary: "Update a status",
					operationId: "updateStatus",
					parameters: [
						workspaceParam,
						{ name: "statusId", in: "path", required: true, schema: { type: "string" } },
					],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										name: { type: "string" },
										category: ref("StatusCategory"),
										color: { type: "string" },
										position: { type: "integer" },
									},
								},
							},
						},
					},
					responses: {
						"200": { description: "OK", content: { "application/json": { schema: ref("Status") } } },
						...commonErrors,
					},
				},
				delete: {
					tags: ["Statuses"],
					summary: "Delete or archive a status",
					description:
						"A status no issue points at is deleted. One that still has issues is archived instead — it stops being offered, and the issues keep their state.",
					operationId: "deleteStatus",
					parameters: [
						workspaceParam,
						{ name: "statusId", in: "path", required: true, schema: { type: "string" } },
					],
					responses: { "204": { description: "Deleted or archived" }, ...commonErrors },
				},
			},
			"/workspaces/{workspace}/labels": {
				get: {
					tags: ["Labels"],
					summary: "List labels",
					operationId: "listLabels",
					parameters: [workspaceParam],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("Label") } },
									},
								},
							},
						},
						...commonErrors,
					},
				},
				post: {
					tags: ["Labels"],
					summary: "Create a label",
					operationId: "createLabel",
					parameters: [workspaceParam],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["name", "color"],
									properties: {
										name: { type: "string" },
										color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
										description: { type: ["string", "null"] },
									},
								},
							},
						},
					},
					responses: {
						"201": { description: "Created", content: { "application/json": { schema: ref("Label") } } },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/labels/{labelId}": {
				patch: {
					tags: ["Labels"],
					summary: "Update a label",
					operationId: "updateLabel",
					parameters: [
						workspaceParam,
						{ name: "labelId", in: "path", required: true, schema: { type: "string" } },
					],
					requestBody: {
						required: true,
						content: { "application/json": { schema: ref("Label") } },
					},
					responses: {
						"200": { description: "OK", content: { "application/json": { schema: ref("Label") } } },
						...commonErrors,
					},
				},
				delete: {
					tags: ["Labels"],
					summary: "Delete a label",
					operationId: "deleteLabel",
					parameters: [
						workspaceParam,
						{ name: "labelId", in: "path", required: true, schema: { type: "string" } },
					],
					responses: { "204": { description: "Deleted" }, ...commonErrors },
				},
			},
			"/workspaces/{workspace}/files": {
				post: {
					tags: ["Files"],
					summary: "Upload a file",
					description:
						"Returns a public URL whose key contains 128 bits of randomness. Anyone with the URL can read the file, so treat it as a capability.",
					operationId: "uploadFile",
					parameters: [workspaceParam],
					requestBody: {
						required: true,
						content: {
							"multipart/form-data": {
								schema: {
									type: "object",
									required: ["file"],
									properties: { file: { type: "string", format: "binary" } },
								},
							},
						},
					},
					responses: {
						"201": { description: "Created", content: { "application/json": { schema: ref("Attachment") } } },
						"413": { ...errorResponse, description: "Larger than 25 MB." },
						"415": { ...errorResponse, description: "That content type is not accepted." },
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/webhooks": {
				get: {
					tags: ["Webhooks"],
					summary: "List webhooks",
					operationId: "listWebhooks",
					parameters: [workspaceParam],
					responses: {
						"200": {
							description: "OK",
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["items"],
										properties: { items: { type: "array", items: ref("Webhook") } },
									},
								},
							},
						},
						...commonErrors,
					},
				},
				post: {
					tags: ["Webhooks"],
					summary: "Register a webhook",
					description: [
						"The response is the only time the signing secret is readable.",
						"",
						"Deliveries are one attempt with no retry. Each carries `X-Tracker-Event`,",
						"`X-Tracker-Timestamp`, and `X-Tracker-Signature`, where the signature is",
						"`sha256=` followed by the HMAC-SHA256 of `<timestamp>.<body>` under the secret.",
					].join("\n"),
					operationId: "createWebhook",
					parameters: [workspaceParam],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["url", "events"],
									properties: {
										url: { type: "string", format: "uri" },
										events: {
											type: "array",
											minItems: 1,
											items: { type: "string", enum: [...WEBHOOK_EVENTS] },
										},
									},
								},
							},
						},
					},
					responses: {
						"201": {
							description: "Created",
							content: {
								"application/json": {
									schema: {
										allOf: [
											ref("Webhook"),
											{
												type: "object",
												required: ["secret"],
												properties: { secret: { type: "string" } },
											},
										],
									},
								},
							},
						},
						...commonErrors,
					},
				},
			},
			"/workspaces/{workspace}/webhooks/{webhookId}": {
				patch: {
					tags: ["Webhooks"],
					summary: "Update a webhook",
					operationId: "updateWebhook",
					parameters: [
						workspaceParam,
						{ name: "webhookId", in: "path", required: true, schema: { type: "string" } },
					],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										url: { type: "string", format: "uri" },
										events: { type: "array", items: { type: "string", enum: [...WEBHOOK_EVENTS] } },
										enabled: { type: "boolean" },
									},
								},
							},
						},
					},
					responses: {
						"200": { description: "OK", content: { "application/json": { schema: ref("Webhook") } } },
						...commonErrors,
					},
				},
				delete: {
					tags: ["Webhooks"],
					summary: "Delete a webhook",
					operationId: "deleteWebhook",
					parameters: [
						workspaceParam,
						{ name: "webhookId", in: "path", required: true, schema: { type: "string" } },
					],
					responses: { "204": { description: "Deleted" }, ...commonErrors },
				},
			},
			"/workspaces/{workspace}/events": {
				get: {
					tags: ["Realtime"],
					summary: "Subscribe to workspace changes",
					description:
						"A `text/event-stream` of the same events webhooks receive. Each message's `event:` field is the event name and `data:` is JSON.",
					operationId: "streamEvents",
					parameters: [workspaceParam],
					responses: {
						"200": {
							description: "An open event stream",
							content: { "text/event-stream": { schema: { type: "string" } } },
						},
						...commonErrors,
					},
				},
			},
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "An API key: `Authorization: Bearer trk_…`",
				},
				apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
			},
			schemas: {
				Error: {
					type: "object",
					required: ["message"],
					properties: { message: { type: "string" } },
				},
				User: {
					type: "object",
					required: ["id", "name", "image", "githubLogin"],
					properties: {
						id: { type: "string" },
						name: { type: "string" },
						image: { type: ["string", "null"] },
						githubLogin: { type: ["string", "null"] },
					},
				},
				Workspace: {
					type: "object",
					required: ["id", "slug", "name", "avatarUrl", "type", "prefix"],
					properties: {
						id: { type: "string" },
						slug: { type: "string", description: "The GitHub owner login." },
						name: { type: "string" },
						avatarUrl: { type: ["string", "null"] },
						type: { type: "string", enum: ["User", "Organization"] },
						prefix: {
							type: "string",
							description: "Identifier prefix used by issues with no repo.",
						},
					},
				},
				Repo: {
					type: "object",
					required: ["id", "name", "description", "isPrivate"],
					properties: {
						id: { type: "string" },
						name: { type: "string" },
						description: { type: ["string", "null"] },
						isPrivate: { type: "boolean" },
					},
				},
				StatusCategory: {
					type: "string",
					enum: ["backlog", "unstarted", "started", "completed", "canceled"],
					description:
						"What the status means, independent of its name. Board grouping and completion timestamps read this, so a renamed status still behaves correctly.",
				},
				Status: {
					type: "object",
					required: ["id", "name", "category", "color", "position"],
					properties: {
						id: { type: "string" },
						name: { type: "string" },
						category: ref("StatusCategory"),
						color: { type: "string" },
						position: { type: "integer" },
					},
				},
				Label: {
					type: "object",
					required: ["id", "name", "color", "description"],
					properties: {
						id: { type: "string" },
						name: { type: "string" },
						color: { type: "string" },
						description: { type: ["string", "null"] },
					},
				},
				Issue: {
					type: "object",
					required: [
						"id", "identifier", "number", "title", "titleHtml", "description",
						"descriptionHtml", "status", "priority", "assignee", "creator", "repo",
						"labels", "position", "commentCount", "createdAt", "updatedAt",
					],
					properties: {
						id: { type: "string" },
						identifier: { type: "string", example: "api-12" },
						number: { type: "integer" },
						title: { type: "string", description: "Markdown, as authored." },
						titleHtml: {
							type: "string",
							description: "`title` rendered to a sanitized inline-only HTML subset.",
						},
						description: { type: "string", description: "Markdown, as authored." },
						descriptionHtml: { type: "string", description: "`description` rendered to sanitized HTML." },
						status: ref("Status"),
						priority: {
							type: "integer",
							enum: [0, 1, 2, 3, 4],
							description: Object.entries(PRIORITY_LABELS)
								.map(([value, label]) => `${value} = ${label}`)
								.join(", "),
						},
						assignee: { oneOf: [ref("User"), { type: "null" }] },
						creator: { oneOf: [ref("User"), { type: "null" }] },
						repo: { oneOf: [ref("Repo"), { type: "null" }] },
						labels: { type: "array", items: ref("Label") },
						position: {
							type: "string",
							description:
								"Opaque sort key. Pass the neighbours' values to `move` to reorder; pass this back as `cursor` to paginate.",
						},
						commentCount: { type: "integer" },
						createdAt: { type: "string", format: "date-time" },
						updatedAt: { type: "string", format: "date-time" },
						completedAt: { type: ["string", "null"], format: "date-time" },
						canceledAt: { type: ["string", "null"], format: "date-time" },
					},
				},
				CreateIssue: {
					type: "object",
					required: ["title"],
					properties: {
						title: { type: "string", description: "Markdown. Inline marks only when displayed." },
						description: { type: "string", description: "Markdown." },
						statusId: { type: "string", description: "Defaults to the workspace's backlog status." },
						repoId: {
							type: ["string", "null"],
							description: "Null or omitted leaves the issue unscoped to any repo.",
						},
						priority: { type: "integer", enum: [0, 1, 2, 3, 4] },
						assigneeId: { type: ["string", "null"] },
						labelIds: { type: "array", items: { type: "string" } },
					},
				},
				UpdateIssue: {
					type: "object",
					description: "Every field is optional; omitted fields are left alone.",
					properties: {
						title: { type: "string" },
						description: { type: "string" },
						statusId: { type: "string" },
						repoId: {
							type: ["string", "null"],
							description: "Moving repos does not change the issue's identifier.",
						},
						priority: { type: "integer", enum: [0, 1, 2, 3, 4] },
						assigneeId: { type: ["string", "null"] },
						labelIds: { type: "array", items: { type: "string" } },
						archived: { type: "boolean" },
						move: {
							type: "object",
							required: ["after", "before"],
							description:
								"Reposition between two issues, using their `position` values. Either end may be null for the start or end of the list.",
							properties: {
								after: { type: ["string", "null"] },
								before: { type: ["string", "null"] },
							},
						},
					},
				},
				Comment: {
					type: "object",
					required: ["id", "body", "bodyHtml", "author", "createdAt", "updatedAt"],
					properties: {
						id: { type: "string" },
						body: { type: "string", description: "Markdown, as authored." },
						bodyHtml: { type: "string" },
						author: { oneOf: [ref("User"), { type: "null" }] },
						createdAt: { type: "string", format: "date-time" },
						updatedAt: { type: "string", format: "date-time" },
					},
				},
				Attachment: {
					type: "object",
					required: ["id", "filename", "contentType", "size", "url", "createdAt"],
					properties: {
						id: { type: "string" },
						filename: { type: "string" },
						contentType: { type: "string" },
						size: { type: "integer", description: "Bytes." },
						url: { type: "string", format: "uri" },
						createdAt: { type: "string", format: "date-time" },
					},
				},
				Webhook: {
					type: "object",
					required: ["id", "url", "events", "enabled", "createdAt"],
					properties: {
						id: { type: "string" },
						url: { type: "string", format: "uri" },
						events: { type: "array", items: { type: "string", enum: [...WEBHOOK_EVENTS] } },
						enabled: { type: "boolean" },
						lastStatus: { type: ["integer", "null"] },
						lastError: { type: ["string", "null"] },
						lastDeliveredAt: { type: ["string", "null"], format: "date-time" },
						createdAt: { type: "string", format: "date-time" },
					},
				},
			},
		},
	};
}
