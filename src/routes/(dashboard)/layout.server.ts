import type { LoadEvent } from "./$types";

export default async function load({ api }: LoadEvent) {
	const [issues, labels, teams] = await Promise.all([
		api.GET("/api/issues").unwrapOr([]),
		api.GET("/api/labels").unwrapOr([]),
		api.GET("/api/teams").unwrapOr([]),
	]);

	return {
		issues,
		labels,
		teams,
	};
}
