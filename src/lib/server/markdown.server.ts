import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { Marked } from "marked";

/**
 * Issue titles and bodies are markdown written by users, so the output is
 * sanitized before it ever reaches a page. Rendering happens here, on the
 * server, so the browser never has to be trusted with the decision.
 */

const window = new JSDOM("").window;
const purify = createDOMPurify(window);

// Links in user content go to the open internet: force them to open elsewhere
// and drop the referrer and window handle.
purify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A" && node.hasAttribute("href")) {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer nofollow");
	}
});

const marked = new Marked({ gfm: true, breaks: true });

const BLOCK_ALLOWED = {
	ALLOWED_TAGS: [
		"p", "br", "hr",
		"h1", "h2", "h3", "h4", "h5", "h6",
		"strong", "em", "del", "code", "pre",
		"a", "img",
		"ul", "ol", "li",
		"blockquote",
		"table", "thead", "tbody", "tr", "th", "td",
		"input", // GFM task-list checkboxes
	],
	ALLOWED_ATTR: ["href", "src", "alt", "title", "type", "checked", "disabled", "align", "class"],
	// `javascript:` and friends never survive this.
	ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
	// Setting ALLOWED_URI_REGEXP makes DOMPurify URI-check `type` as well — its
	// guard against `<object type="...">`. That strips `type="checkbox"` off GFM
	// task lists and leaves them rendering as text boxes. `object` and `embed`
	// are not allowed tags here, so exempting `type` gives up nothing.
	ADD_URI_SAFE_ATTR: ["type"],
};

/**
 * Titles render an inline-only subset. A title that produced a heading or a
 * list would break every row it appears in, so block markdown is not parsed at
 * all rather than parsed and stripped.
 */
const INLINE_ALLOWED = {
	ALLOWED_TAGS: ["strong", "em", "del", "code", "a"],
	ALLOWED_ATTR: ["href", "title"],
	ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
};

/** Renders a markdown body to sanitized HTML. */
export function renderMarkdown(source: string): string {
	if (source.trim() === "") return "";
	const html = marked.parse(source, { async: false });
	return purify.sanitize(html, { ...BLOCK_ALLOWED }) as string;
}

/** Renders a markdown title to sanitized inline HTML. */
export function renderInlineMarkdown(source: string): string {
	if (source.trim() === "") return "";
	const html = marked.parseInline(source, { async: false });
	return purify.sanitize(html, { ...INLINE_ALLOWED }) as string;
}

/** Markdown with every mark removed — for `<title>`, search, and notifications. */
export function markdownToText(source: string): string {
	const html = marked.parseInline(source, { async: false });
	const stripped = purify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as string;
	return window.document.createRange().createContextualFragment(`<i>${stripped}</i>`)
		.textContent!.trim();
}
