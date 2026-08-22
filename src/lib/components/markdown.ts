import { Div, Html, type Readable } from "@implementjs/core";
import { cn } from "@/lib/utils";

/**
 * Renders HTML the server already produced and sanitized. The browser never
 * parses markdown and never decides what is safe — see
 * `src/lib/server/markdown.server.ts`.
 */

const PROSE = [
	"[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
	"[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
	"[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
	"[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold",
	"[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
	"[&_li]:my-0.5 [&_li_input]:mr-1.5 [&_li_input]:align-middle",
	"[&_li:has(>input)]:list-none [&_li:has(>input)]:-ml-5",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
	"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
	"[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3",
	"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
	"[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
	"[&_hr]:my-4 [&_hr]:border-t",
	"[&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_table]:text-sm",
	"[&_th]:border-b [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium",
	"[&_td]:border-b [&_td]:px-2 [&_td]:py-1.5",
	"[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border",
].join(" ");

/** A rendered markdown body — headings, lists, tables, code. */
export function Markdown(html: Readable<string> | string, className?: string) {
	return Div({ class: cn("text-sm leading-relaxed", PROSE, className) }, Html(html));
}

/**
 * A rendered markdown title. The server only ever emits inline marks here, so
 * this stays on one line and can sit inside a table row or a button.
 */
export function InlineMarkdown(html: Readable<string> | string, className?: string) {
	return Div(
		{
			class: cn(
				"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.9em]",
				"[&_a]:underline [&_a]:underline-offset-2",
				className,
			),
		},
		Html(html),
	);
}
