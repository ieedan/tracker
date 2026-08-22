import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { list } from "@/lib/server/issues.server";
import type { LoadEvent } from "./$types";

/** `?status=a,b` and friends — the same shape the filter bar writes. */
function csv(url: URL, name: string): string[] | undefined {
	const raw = url.searchParams.getAll(name).flatMap((value) => value.split(","));
	const values = raw.map((value) => value.trim()).filter(Boolean);
	return values.length > 0 ? values : undefined;
}

/**
 * The first page of issues, rendered into the HTML so the list is there before
 * any JavaScript runs.
 *
 * The filters are read here as well as on the client, so a link to a filtered
 * view arrives filtered rather than showing everything and then narrowing.
 */
export default async function load({ locals, params, url }: LoadEvent) {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const page = await list(workspace.id, {
		statusIds: csv(url, "status"),
		assigneeIds: csv(url, "assignee"),
		labelIds: csv(url, "label"),
		priorities: csv(url, "priority")?.map(Number).filter(Number.isInteger),
		repos: csv(url, "repo"),
		query: url.searchParams.get("q") ?? undefined,
		limit: 200,
	});

	return { page };
}
