import { error } from "@implementjs/kit/server";
import { z } from "zod";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json, parseBody } from "@/lib/server/api.server";
import { addComment, getByIdentifier, listComments } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const issue = await getByIdentifier(workspace.id, params.identifier);
	if (issue === null) error(404, `No issue ${params.identifier}`);

	return json({ items: await listComments(issue.id) });
}

const createBody = z.object({ body: z.string().min(1).max(100_000) });

export async function POST({ locals, params, request }: RequestEvent): Promise<Response> {
	const { caller, workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const issue = await getByIdentifier(workspace.id, params.identifier);
	if (issue === null) error(404, `No issue ${params.identifier}`);

	const { body } = await parseBody(request, createBody);
	return json(await addComment(workspace.id, issue.id, caller.id, body), { status: 201 });
}
