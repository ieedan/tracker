import type { LoadEvent } from "./$types";

export default async function load({ api }: LoadEvent) {
	const [issues, labels] = await Promise.all([
		api.GET("/api/issues").unwrapOr([]),
		api.GET("/api/labels").unwrapOr([]),
	]);

	return {
		issues,
		labels,
	};
}
