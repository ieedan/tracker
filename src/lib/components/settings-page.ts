import { Div, H1, P, type Child, type Readable } from "@implementjs/core";

/** The frame every settings screen sits in: a title, a sentence, and content. */
export function SettingsPage(title: string, description: string, ...children: Child[]) {
	return Div(
		{ class: "min-h-0 flex-1 overflow-y-auto" },
		Div(
			{ class: "mx-auto max-w-2xl space-y-6 px-6 py-8" },
			Div(
				{ class: "space-y-1" },
				H1({ class: "text-lg font-semibold tracking-tight" }, title),
				P({ class: "text-sm text-muted-foreground" }, description),
			),
			...children,
		),
	);
}

/** A read-only row, for values that are mirrored rather than edited here. */
export function InfoRow(label: string, value: Readable<string> | string, hint?: string) {
	return Div(
		{ class: "flex items-start gap-4 px-3 py-2.5" },
		Div({ class: "w-32 shrink-0 text-sm text-muted-foreground" }, label),
		Div(
			{ class: "min-w-0 flex-1" },
			Div({ class: "text-sm" }, value),
			hint === undefined ? null : Div({ class: "mt-0.5 text-xs text-muted-foreground" }, hint),
		),
	);
}
