import { Div, H1, P } from "@implementjs/core";
import type { ErrorProps } from "./$types";

/** Renders when no route matches, or when a page or layout throws while rendering. */
export default function ErrorPage({ error }: ErrorProps) {
	return Div(
		{ class: "flex min-h-dvh flex-col items-center justify-center gap-6 p-8" },
		H1({ class: "text-3xl font-semibold tracking-tight" }, `${error.code}`),
		P({ class: "text-sm text-muted-foreground" }, error.message),
	);
}
