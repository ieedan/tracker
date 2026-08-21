import { A, Div, H1, P } from "@implementjs/core";
import { env } from "@/lib/env.public";

export default function Page() {
	return Div(
		{ class: "flex min-h-dvh flex-col items-center justify-center gap-6 p-8" },
		H1({ class: "text-3xl font-semibold tracking-tight" }, env.PUBLIC_APP_NAME),
		P(
			{ class: "text-sm text-muted-foreground" },
			"This page is ",
			"src/routes/about/page.ts",
			" — every directory under src/routes with a page.ts is a route.",
		),
		A({ class: "underline underline-offset-4 text-muted-foreground hover:text-foreground", href: "https://github.com/ieedan/implement" }, "Read the docs"),
	);
}
