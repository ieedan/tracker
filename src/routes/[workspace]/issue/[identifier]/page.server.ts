import { error } from "@implementjs/kit/server";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { getByIdentifier, listComments } from "@/lib/server/issues.server";
import { markdownToText } from "@/lib/server/markdown.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const issue = await getByIdentifier(workspace.id, params.identifier);
	if (issue === null) error(404, `No issue ${params.identifier}`);

	return {
		issue,
		comments: await listComments(issue.id),
		// Markdown in a <title> would render as literal asterisks.
		plainTitle: markdownToText(issue.title),
	};
}
