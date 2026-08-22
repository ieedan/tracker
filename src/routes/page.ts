import { Div, H1, P } from "@implementjs/core";

/**
 * Only ever reached when the load found no workspaces — a signed-in account
 * whose GitHub token reports no owners at all.
 */
export default function Page() {
	return Div(
		{ class: "flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center" },
		H1({ class: "text-lg font-semibold" }, "No workspaces yet"),
		P(
			{ class: "max-w-md text-sm text-muted-foreground" },
			"A workspace mirrors a GitHub user or organization. This account doesn't appear to belong to any — check that you granted the ",
			"read:org",
			" scope when signing in.",
		),
	);
}
