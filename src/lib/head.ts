import { type Bindable, type HeadChild, ImplementHead, type Mountable } from "@implementjs/core";

/**
 * Document metadata for a route.
 *
 * Titles and descriptions are set per *page*, never in a layout: `ImplementHead`
 * keeps a tag in the head for as long as the node that declared it is mounted,
 * so a layout-level `<meta name="description">` would sit alongside the page's
 * own and ship two of them. The layouts stay out of it and every `page.ts`
 * declares its own pair, which is also why `PageMeta` lives here rather than in
 * the feature components — those are shared between routes.
 */

/** The product name, and the tail of every title. */
export const APP_NAME = "tracker";

/** What the app is, for routes with nothing more specific to say. */
export const DEFAULT_DESCRIPTION =
	"tracker is a fast issue tracker for software teams — issues, teams, feedback, and the API that drives them.";

/** How long a `<meta name="description">` is worth writing before search engines cut it. */
const DESCRIPTION_LIMIT = 160;

/**
 * `"ENG-31 Add route metadata"` becomes `"ENG-31 Add route metadata · tracker"`.
 * An empty segment (a title that depends on data still loading) falls back to
 * the bare product name rather than rendering a stray separator.
 */
export function pageTitle(...segments: Array<string | null | undefined>): string {
	const parts = segments
		.map((segment) => segment?.trim() ?? "")
		.filter((segment) => segment.length > 0);

	return parts.length === 0 ? APP_NAME : `${parts.join(" · ")} · ${APP_NAME}`;
}

/**
 * Flattens body text into something a `<meta>` can hold: markdown syntax and
 * newlines collapsed away, then cut at a word boundary. Falls back to
 * `fallback` when the source is empty, so a description-less issue still
 * describes itself.
 */
export function metaDescription(
	text: string | null | undefined,
	fallback: string = DEFAULT_DESCRIPTION,
): string {
	const flattened = (text ?? "")
		// Images, then links: `![alt](src)` -> "", `[text](href)` -> "text".
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// Fenced code blocks are noise in a search result.
		.replace(/```[\s\S]*?```/g, " ")
		// Leading list/heading/quote markers and inline emphasis.
		.replace(/^\s{0,3}(?:[#>]+|[-*+]|\d+\.)\s+/gm, " ")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	if (flattened.length === 0) return fallback;
	if (flattened.length <= DESCRIPTION_LIMIT) return flattened;

	const cut = flattened.slice(0, DESCRIPTION_LIMIT - 1);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type PageMetaProps = {
	/** The full document title. Build it with {@link pageTitle}. */
	title: Bindable<string>;
	/** One sentence for search results and link previews. */
	description?: Bindable<string>;
	/**
	 * Keeps a page out of search indexes. Anything behind a session is invisible
	 * to a crawler anyway, so this is for pages that are reachable but should not
	 * be listed — an invite link, the OAuth consent screen.
	 */
	noindex?: boolean;
};

/**
 * A route's `<title>` and description, plus the Open Graph twins so a link
 * pasted into a chat shows the same thing.
 *
 * ```ts
 * export default function Page({ data }: PageProps) {
 * 	return Fragment(
 * 		PageMeta({
 * 			title: data.bind((d) => pageTitle(d.issue.identifier, d.issue.title)),
 * 			description: data.bind((d) => metaDescription(d.issue.description)),
 * 		}),
 * 		IssueDetailPage({ data }),
 * 	);
 * }
 * ```
 */
export function PageMeta({
	title,
	description = DEFAULT_DESCRIPTION,
	noindex = false,
}: PageMetaProps): Mountable {
	const children: HeadChild[] = [
		ImplementHead.Title(title),
		ImplementHead.Meta({ name: "description", content: description }),
		ImplementHead.Meta({ property: "og:title", content: title }),
		ImplementHead.Meta({ property: "og:description", content: description }),
		ImplementHead.Meta({ property: "og:site_name", content: APP_NAME }),
		ImplementHead.Meta({ name: "twitter:card", content: "summary" }),
	];

	// A crawler never gets past the session on most of these routes, so this is
	// only for the ones a stranger can actually reach.
	if (noindex) children.push(ImplementHead.Meta({ name: "robots", content: "noindex" }));

	return ImplementHead(...children);
}
