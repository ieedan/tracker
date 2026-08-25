import { Div, Fragment, H1, P } from "@implementjs/core";
import { metaDescription, PageMeta, pageTitle } from "@/lib/head";
import type { ErrorProps } from "./$types";

/** Renders when no route matches, or when a page or layout throws while rendering. */
export default function ErrorPage({ error }: ErrorProps) {
	return Fragment(
		PageMeta({
			title: pageTitle(`${error.code} ${error.message}`),
			description: metaDescription(error.message, `Something went wrong (${error.code}).`),
			noindex: true,
		}),
		Div(
			{ class: "flex min-h-dvh flex-col items-center justify-center gap-6 p-8" },
			H1({ class: "text-3xl font-semibold tracking-tight" }, `${error.code}`),
			P({ class: "text-sm text-muted-foreground" }, error.message),
		),
	);
}
