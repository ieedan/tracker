import { error } from "@implementjs/kit/server";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, noContent, parseBody } from "@/lib/server/api.server";
import { getByIdentifier, remove, update } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const issue = await getByIdentifier(workspace.id, params.identifier);
	if (issue === null) error(404, `No issue ${params.identifier}`);
	return json(issue);
}

const patchBody = z.object({
	title: z.string().min(1).max(1024).optional(),
	description: z.string().max(100_000).optional(),
	statusId: z.string().optional(),
	repoId: z.string().nullable().optional(),
	priority: z.number().int().min(0).max(4).optional(),
	assigneeId: z.string().nullable().optional(),
	labelIds: z.array(z.string()).optional(),
	archived: z.boolean().optional(),
	move: z
		.object({ after: z.string().nullable(), before: z.string().nullable() })
		.optional(),
});

export async function PATCH({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const existing = await getByIdentifier(workspace.id, params.identifier);
	if (existing === null) error(404, `No issue ${params.identifier}`);

	return json(await update(workspace.id, existing.id, await parseBody(request, patchBody)));
}

export async function DELETE({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const existing = await getByIdentifier(workspace.id, params.identifier);
	if (existing === null) error(404, `No issue ${params.identifier}`);

	await remove(workspace.id, existing.id);
	return noContent();
}
