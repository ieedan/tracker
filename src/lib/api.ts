import type {
	ApiKeyDto,
	AttachmentDto,
	CommentDto,
	IssueDto,
	LabelDto,
	Paginated,
	RepoDto,
	StatusDto,
	UserDto,
	WebhookDto,
	WorkspaceDto,
} from "./types";

/**
 * The browser's view of `/api/v1` — the same surface documented in
 * `openapi.json`, so the app is its own best proof the API works.
 */

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`/api/v1${path}`, {
		...init,
		headers: {
			...(init.body !== undefined && !(init.body instanceof FormData)
				? { "content-type": "application/json" }
				: {}),
			...init.headers,
		},
	});

	if (response.status === 204) return undefined as T;

	const body = await response.text();
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(body);
	} catch {
		/* a proxy or a crash answered with something that isn't JSON */
	}

	if (!response.ok) {
		const message =
			typeof parsed === "object" && parsed !== null && "message" in parsed
				? String((parsed as { message: unknown }).message)
				: `Request failed (${response.status})`;
		throw new ApiError(response.status, message);
	}

	return parsed as T;
}

const encode = (value: string) => encodeURIComponent(value);

export type IssueQuery = {
	status?: string[];
	assignee?: string[];
	label?: string[];
	priority?: number[];
	/** Repo ids; `"none"` matches issues with no repo. */
	repo?: string[];
	q?: string;
	limit?: number;
	cursor?: string;
};

function issueSearch(query: IssueQuery): string {
	const params = new URLSearchParams();
	for (const id of query.status ?? []) params.append("status", id);
	for (const id of query.assignee ?? []) params.append("assignee", id);
	for (const id of query.label ?? []) params.append("label", id);
	for (const value of query.priority ?? []) params.append("priority", String(value));
	for (const id of query.repo ?? []) params.append("repo", id);
	if (query.q !== undefined && query.q !== "") params.set("q", query.q);
	if (query.limit !== undefined) params.set("limit", String(query.limit));
	if (query.cursor !== undefined) params.set("cursor", query.cursor);
	const search = params.toString();
	return search === "" ? "" : `?${search}`;
}

export const api = {
	me: () =>
		request<{ user: { id: string; name: string; image: string | null }; workspaces: WorkspaceDto[] }>(
			"/me",
		),

	issues: {
		list: (workspace: string, query: IssueQuery = {}) =>
			request<Paginated<IssueDto>>(`/workspaces/${encode(workspace)}/issues${issueSearch(query)}`),

		get: (workspace: string, identifier: string) =>
			request<IssueDto>(`/workspaces/${encode(workspace)}/issues/${encode(identifier)}`),

		create: (
			workspace: string,
			body: {
				title: string;
				description?: string;
				statusId?: string;
				repoId?: string | null;
				priority?: number;
				assigneeId?: string | null;
				labelIds?: string[];
			},
		) =>
			request<IssueDto>(`/workspaces/${encode(workspace)}/issues`, {
				method: "POST",
				body: JSON.stringify(body),
			}),

		update: (
			workspace: string,
			identifier: string,
			body: Record<string, unknown>,
		) =>
			request<IssueDto>(`/workspaces/${encode(workspace)}/issues/${encode(identifier)}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),

		remove: (workspace: string, identifier: string) =>
			request<void>(`/workspaces/${encode(workspace)}/issues/${encode(identifier)}`, {
				method: "DELETE",
			}),
	},

	comments: {
		list: (workspace: string, identifier: string) =>
			request<{ items: CommentDto[] }>(
				`/workspaces/${encode(workspace)}/issues/${encode(identifier)}/comments`,
			),

		create: (workspace: string, identifier: string, body: string) =>
			request<CommentDto>(
				`/workspaces/${encode(workspace)}/issues/${encode(identifier)}/comments`,
				{ method: "POST", body: JSON.stringify({ body }) },
			),

		remove: (workspace: string, identifier: string, commentId: string) =>
			request<void>(
				`/workspaces/${encode(workspace)}/issues/${encode(identifier)}/comments/${encode(commentId)}`,
				{ method: "DELETE" },
			),
	},

	statuses: {
		list: (workspace: string) =>
			request<{ items: StatusDto[] }>(`/workspaces/${encode(workspace)}/statuses`),
		create: (workspace: string, body: { name: string; category: string; color: string }) =>
			request<StatusDto>(`/workspaces/${encode(workspace)}/statuses`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (workspace: string, id: string, body: Record<string, unknown>) =>
			request<StatusDto>(`/workspaces/${encode(workspace)}/statuses/${encode(id)}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		remove: (workspace: string, id: string) =>
			request<void>(`/workspaces/${encode(workspace)}/statuses/${encode(id)}`, { method: "DELETE" }),
	},

	labels: {
		list: (workspace: string) =>
			request<{ items: LabelDto[] }>(`/workspaces/${encode(workspace)}/labels`),
		create: (workspace: string, body: { name: string; color: string; description?: string | null }) =>
			request<LabelDto>(`/workspaces/${encode(workspace)}/labels`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (workspace: string, id: string, body: Record<string, unknown>) =>
			request<LabelDto>(`/workspaces/${encode(workspace)}/labels/${encode(id)}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		remove: (workspace: string, id: string) =>
			request<void>(`/workspaces/${encode(workspace)}/labels/${encode(id)}`, { method: "DELETE" }),
	},

	repos: {
		list: (workspace: string) =>
			request<{ items: RepoDto[] }>(`/workspaces/${encode(workspace)}/repos`),
	},

	/** Whoever has appeared on an issue here — see the endpoint's description. */
	members: {
		list: (workspace: string) =>
			request<{ items: UserDto[] }>(`/workspaces/${encode(workspace)}/members`),
	},

	files: {
		upload: (workspace: string, file: File) => {
			const form = new FormData();
			form.append("file", file);
			return request<AttachmentDto>(`/workspaces/${encode(workspace)}/files`, {
				method: "POST",
				body: form,
			});
		},
	},

	webhooks: {
		list: (workspace: string) =>
			request<{ items: WebhookDto[] }>(`/workspaces/${encode(workspace)}/webhooks`),
		create: (workspace: string, body: { url: string; events: string[] }) =>
			request<WebhookDto>(`/workspaces/${encode(workspace)}/webhooks`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (workspace: string, id: string, body: Record<string, unknown>) =>
			request<WebhookDto>(`/workspaces/${encode(workspace)}/webhooks/${encode(id)}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		remove: (workspace: string, id: string) =>
			request<void>(`/workspaces/${encode(workspace)}/webhooks/${encode(id)}`, { method: "DELETE" }),
	},
};

/* -------------------------------------------------------------------------- */
/*                                 auth + keys                                */
/* -------------------------------------------------------------------------- */

/**
 * better-auth lives at `/api/auth`, outside the versioned API, so these go
 * through their own helper rather than `request`.
 */
async function auth<T>(path: string, body?: unknown): Promise<T> {
	const response = await fetch(`/api/auth${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const text = await response.text();
	const parsed = text === "" ? null : JSON.parse(text);

	if (!response.ok) {
		throw new ApiError(response.status, parsed?.message ?? `Request failed (${response.status})`);
	}

	return parsed as T;
}

export const authApi = {
	signInWithGithub: () =>
		auth<{ url: string; redirect: boolean }>("/sign-in/social", {
			provider: "github",
			callbackURL: "/",
		}),

	signInWithPassword: (email: string, password: string) =>
		auth<unknown>("/sign-in/email", { email, password }),

	signOut: () => auth<unknown>("/sign-out", {}),

	apiKeys: {
		// The plugin answers with `{ apiKeys, total }` rather than a bare array.
		list: async (): Promise<ApiKeyDto[]> =>
			(await auth<{ apiKeys: ApiKeyDto[] }>("/api-key/list")).apiKeys,
		// `key` is present on this response only — it is stored hashed.
		create: (name: string) => auth<ApiKeyDto>("/api-key/create", { name }),
		remove: (keyId: string) => auth<unknown>("/api-key/delete", { keyId }),
	},
};
