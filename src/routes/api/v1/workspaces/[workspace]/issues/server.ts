import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { csv, json, parseBody, parseQuery } from "@/lib/server/api.server";
import { create, list } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

const listQuery = z.object({
	status: z.union([z.string(), z.array(z.string())]).optional(),
	assignee: z.union([z.string(), z.array(z.string())]).optional(),
	label: z.union([z.string(), z.array(z.string())]).optional(),
	priority: z.union([z.string(), z.array(z.string())]).optional(),
	repo: z.union([z.string(), z.array(z.string())]).optional(),
	q: z.string().optional(),
	includeArchived: z.enum(["true", "false"]).optional(),
	limit: z.coerce.number().int().min(1).max(250).optional(),
	cursor: z.string().optional(),
});

export async function GET({ locals, params, url }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const query = parseQuery(url, listQuery);

	return json(
		await list(workspace.id, {
			statusIds: csv(query.status),
			assigneeIds: csv(query.assignee),
			labelIds: csv(query.label),
			priorities: csv(query.priority)?.map(Number).filter((n) => Number.isInteger(n)),
			repos: csv(query.repo),
			query: query.q,
			includeArchived: query.includeArchived === "true",
			limit: query.limit,
			cursor: query.cursor,
		}),
	);
}

const createBody = z.object({
	title: z.string().min(1).max(1024),
	description: z.string().max(100_000).optional(),
	statusId: z.string().optional(),
	repoId: z.string().nullable().optional(),
	priority: z.number().int().min(0).max(4).optional(),
	assigneeId: z.string().nullable().optional(),
	labelIds: z.array(z.string()).optional(),
});

export async function POST({ locals, params, request }: RequestEvent): Promise<Response> {
	const { caller, workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const body = await parseBody(request, createBody);

	const issue = await create({ ...body, workspaceId: workspace.id, creatorId: caller.id });
	return json(issue, { status: 201 });
}
