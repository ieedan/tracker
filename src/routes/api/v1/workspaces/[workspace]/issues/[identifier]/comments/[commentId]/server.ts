import { error } from "@implementjs/kit/server";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { noContent } from "@/lib/server/api.server";
import { getByIdentifier, removeComment } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

export async function DELETE({ locals, params }: RequestEvent): Promise<Response> {
	const { caller, workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	const issue = await getByIdentifier(workspace.id, params.identifier);
	if (issue === null) error(404, `No issue ${params.identifier}`);

	await removeComment(workspace.id, issue.id, params.commentId, caller.id);
	return noContent();
}
