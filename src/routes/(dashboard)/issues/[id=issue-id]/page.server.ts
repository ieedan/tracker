import { error } from "@implementjs/kit/server";
import type { LoadEvent } from "./$types";

export default async function load({ api, params }: LoadEvent) {
	const [issue] = await Promise.all([
		api.GET("/api/issues/[id=int]", { params: { id: params.id.id } }).unwrapOr(null),
	]);

	if (!issue) error(404, "Issue not found");

	return {
		issue,
	};
}
