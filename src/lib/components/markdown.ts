/**
 * Markdown, rendered as DOM nodes.
 *
 * Comment bodies are written as markdown — people reach for `**bold**` and
 * fenced code without being told to, and agents write nothing else — but every
 * surface painted them as plain text, so a comment arrived as a wall of
 * asterisks and backticks.
 *
 * # Why this is hand-rolled
 *
 * The obvious alternative is a parser plus a sanitizer, and the sanitizer is
 * the problem: every one worth trusting works on an HTML string, which means
 * the pipeline is markdown → HTML → scrub → `innerHTML`. That needs a DOM to
 * scrub against, and these pages render on the server too, so it would want
 * jsdom in the server bundle for a feature whose whole job is drawing a
 * paragraph.
 *
 * Building nodes instead removes the question. There is no HTML string at any
 * point, so there is nothing to inject into: text goes through `document
 * .createTextNode` (or the server renderer's escaper), and the only attribute
 * this file ever sets on a parsed node is `href`, which is checked against a
 * scheme allowlist first. Raw HTML in a body is not parsed — `<img onerror=…>`
 * is characters, and renders as the characters it is. Event-handler attributes
 * are unreachable by construction rather than filtered out.
 *
 * That posture is the reason this is a subset rather than CommonMark: HTML
 * blocks, reference links, and entity escapes are the three places where a
 * fuller implementation would start handing raw markup around, and none of
 * them is what a comment box is for.
 *
 * # What is supported
 *
 * Headings, paragraphs with soft line breaks, `**bold**`, `*italic*`,
 * `~~strikethrough~~`, `` `code` ``, fenced code blocks, bulleted and numbered
 * lists (nested, and with block content inside an item), blockquotes,
 * horizontal rules, `[links](url)`, `<autolinks>`, and bare URLs. `@file`
 * references keep the pill they already had — they are markdown links, so they
 * come through the same path rather than a second one.
 */
import {
	A,
	Blockquote,
	Br,
	Code,
	Del,
	Div,
	Dynamic,
	Em,
	H1,
	H2,
	H3,
	H4,
	H5,
	H6,
	Hr,
	Li,
	Ol,
	P,
	Pre,
	Span,
	Strong,
	Ul,
	type Child,
	type ClassValue,
	type Readable,
} from "@implementjs/core";
import { cn } from "@/lib/utils";

/**
 * Renders a markdown body.
 *
 * The whole body is re-parsed when the text changes. Comments are posted, not
 * typed into this, so the text changes about once per comment.
 */
export function Markdown(body: Readable<string>, options: { class?: ClassValue } = {}) {
	return Div(
		{
			// The first and last block lose their outer margin so the body sits
			// flush in whatever laid it out, rather than a comment being taller
			// than the text it contains.
			class: cn(
				"text-[13px] leading-relaxed break-words [&>:first-child]:mt-0 [&>:last-child]:mb-0",
				options.class,
			),
		},
		Dynamic([body], (text) => Span({ class: "contents" }, ...renderMarkdown(text))),
	);
}

/** The nodes for one body, for a caller that is not rendering from a signal. */
export function renderMarkdown(text: string): Child[] {
	// Tabs are expanded once, up front: everything below decides nesting by
	// counting leading spaces, and a tab that stays a tab counts as one.
	return renderBlocks(parseBlocks(text.replaceAll("\t", "    "), 0));
}

/**
 * A `@file` reference, as the composer's overlay also draws it.
 *
 * Lives here rather than beside the `@` machinery so the dependency runs one
 * way: this is a component, the mention menu is a feature that uses it.
 */
export function MentionLink(path: string, url: string): Child {
	return A(
		{
			href: url,
			target: "_blank",
			rel: "noreferrer",
			class:
				"inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-1 font-mono text-[0.9em] hover:border-ring",
			title: url,
		},
		`@${path.slice(path.lastIndexOf("/") + 1)}`,
	);
}

/* -------------------------------------------------------------------------- */
/* URLs                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The href to use for a link target, or null if it should stay text.
 *
 * Only `http:`, `https:` and `mailto:` are allowed through, plus root-relative
 * paths, which is what an attachment or an in-app route looks like. Everything
 * else — `javascript:`, `data:`, `vbscript:`, a scheme nobody has invented yet
 * — fails the check and the link renders as its own label instead.
 *
 * The test runs against a copy with control characters and spaces removed,
 * because `java\tscript:alert(1)` is a URL the browser will happily follow and
 * a naive `startsWith` will happily miss.
 */
export function safeUrl(raw: string): string | null {
	const target = raw.trim();
	if (target === "") return null;

	// Not a regex, because a character class of control characters is exactly
	// what the linter is there to catch — and stripping them is the point: a
	// control character inside a scheme is how the scheme gets past a check.
	const collapsed = [...target].filter((char) => char > " " && char !== "\u007f").join("");
	if (collapsed === "") return null;

	if (/^[a-z][a-z0-9+.-]*:/i.test(collapsed)) {
		return /^(?:https?|mailto):/i.test(collapsed) ? target : null;
	}

	// Scheme-relative (`//evil.example`) is an absolute URL wearing a relative
	// coat, so it is held to the same standard as one and rejected.
	if (collapsed.startsWith("//")) return null;
	return collapsed.startsWith("/") || collapsed.startsWith("#") ? target : null;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

type Block =
	| { kind: "paragraph"; text: string }
	| { kind: "heading"; level: number; text: string }
	| { kind: "code"; language: string; text: string }
	| { kind: "list"; ordered: boolean; start: number; loose: boolean; items: Block[][] }
	| { kind: "quote"; blocks: Block[] }
	| { kind: "rule" };

/**
 * How far a list or quote may nest before the parser stops descending.
 *
 * Bodies come from the network, so "deeply nested" includes "ten thousand
 * `>` characters, on purpose". Past the limit the remainder renders as text,
 * which is a worse-looking comment and not a blown stack.
 */
const MAX_DEPTH = 8;

const FENCE = /^ {0,3}(```+|~~~+)[ \t]*([^`\n]*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( *)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(.*)$/;

interface ItemMatch {
	indent: number;
	ordered: boolean;
	start: number;
	/** Marker plus the space after it, so a continuation line can be dedented. */
	width: number;
	rest: string;
}

function matchItem(line: string): ItemMatch | null {
	const found = ITEM.exec(line);
	if (found === null) return null;

	const indent = found[1]!.length;
	const marker = found[2] ?? `${found[3]!}${found[4]!}`;
	return {
		indent,
		ordered: found[2] === undefined,
		start: found[3] === undefined ? 1 : Number.parseInt(found[3], 10),
		width: marker.length + found[5]!.length,
		rest: found[6]!,
	};
}

/** Whether a line opens a block, and so cannot be swallowed by a paragraph. */
function startsBlock(line: string): boolean {
	return (
		FENCE.test(line) ||
		HEADING.test(line) ||
		RULE.test(line) ||
		QUOTE.test(line) ||
		matchItem(line) !== null
	);
}

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

function parseBlocks(source: string, depth: number): Block[] {
	const lines = source.split("\n");
	const blocks: Block[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index]!;

		if (line.trim() === "") {
			index++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence !== null) {
			const marker = fence[1]![0]!;
			const length = fence[1]!.length;
			const inset = indentOf(line);
			const body: string[] = [];
			index++;
			while (index < lines.length) {
				const closing = FENCE.exec(lines[index]!);
				// A fence closes on the same character, at least as long, and with
				// nothing after it — so a ```ts inside a ```` block stays content.
				if (
					closing !== null &&
					closing[1]![0] === marker &&
					closing[1]!.length >= length &&
					closing[2]!.trim() === ""
				) {
					index++;
					break;
				}
				// Unclosed fences run to the end, which is what a half-typed body
				// looks like — better than dropping the rest of the comment.
				body.push(lines[index]!.slice(Math.min(inset, indentOf(lines[index]!))));
				index++;
			}
			blocks.push({ kind: "code", language: fence[2]!.trim(), text: body.join("\n") });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading !== null) {
			blocks.push({
				kind: "heading",
				level: heading[1]!.length,
				// `## Title ##` is the closed form; the trailing hashes are syntax.
				text: heading[2]!.replace(/[ \t]+#+[ \t]*$/, "").trim(),
			});
			index++;
			continue;
		}

		if (RULE.test(line)) {
			blocks.push({ kind: "rule" });
			index++;
			continue;
		}

		if (QUOTE.test(line)) {
			const quoted: string[] = [];
			while (index < lines.length) {
				const current = lines[index]!;
				if (QUOTE.test(current)) {
					quoted.push(current.replace(/^ {0,3}> ?/, ""));
					index++;
					continue;
				}
				// A quote continues through unmarked lines the way a paragraph
				// does, but stops at a blank one or at anything that opens a block.
				if (current.trim() === "" || startsBlock(current)) break;
				quoted.push(current);
				index++;
			}
			const inner = quoted.join("\n");
			blocks.push({
				kind: "quote",
				blocks:
					depth >= MAX_DEPTH ? [{ kind: "paragraph", text: inner }] : parseBlocks(inner, depth + 1),
			});
			continue;
		}

		const item = matchItem(line);
		if (item !== null) {
			const consumed = parseList(lines, index, item, depth);
			blocks.push(consumed.block);
			index = consumed.next;
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length && lines[index]!.trim() !== "" && !startsBlock(lines[index]!)) {
			paragraph.push(lines[index]!.trim());
			index++;
		}
		blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
	}

	return blocks;
}

/**
 * One list, from its first item to the first line that is not part of it.
 *
 * Items collect their own lines and are parsed as blocks in their own right,
 * which is what makes a nested list, a second paragraph, or a fenced block
 * inside a bullet work without any of them being special-cased here.
 *
 * A blank line between items makes the list "loose", the term for the version
 * that wraps each item in a paragraph and so breathes; that is the only thing
 * the flag is for.
 */
function parseList(
	lines: string[],
	from: number,
	first: ItemMatch,
	depth: number,
): { block: Block; next: number } {
	const base = first.indent;
	const items: string[][] = [];
	let content = base + first.width;
	let blanks = 0;
	let loose = false;
	let index = from;

	while (index < lines.length) {
		const line = lines[index]!;

		if (line.trim() === "") {
			blanks++;
			index++;
			continue;
		}

		const inset = indentOf(line);
		const next = matchItem(line);

		// Indented past the current item's text column: its own content,
		// dedented so the recursive parse sees it at column zero. Checked
		// before the sibling case, because that is the only thing separating
		// `  - inner` (a nested list) from `- sibling` — both match ITEM, and
		// testing for a sibling first flattens every nested list into one.
		if (items.length > 0 && inset >= content) {
			if (blanks > 0) {
				loose = true;
				items.at(-1)!.push("");
			}
			blanks = 0;
			items.at(-1)!.push(line.slice(content));
			index++;
			continue;
		}

		// A sibling: same kind of marker, not indented far enough to be nested.
		if (next !== null && next.ordered === first.ordered && inset <= base + 3) {
			if (blanks > 0 && items.length > 0) loose = true;
			blanks = 0;
			items.push([next.rest]);
			content = inset + next.width;
			index++;
			continue;
		}

		// A bare continuation line, the way a paragraph runs on. Only while no
		// blank line has intervened — after one, an unindented line has left.
		if (blanks === 0 && !startsBlock(line)) {
			items.at(-1)?.push(line.trim());
			index++;
			continue;
		}

		break;
	}

	return {
		block: {
			kind: "list",
			ordered: first.ordered,
			start: first.start,
			loose,
			items: items.map((item) => {
				const inner = item.join("\n");
				return depth >= MAX_DEPTH
					? [{ kind: "paragraph", text: inner } as Block]
					: parseBlocks(inner, depth + 1);
			}),
		},
		next: index,
	};
}

/* -------------------------------------------------------------------------- */
/* Block rendering                                                             */
/* -------------------------------------------------------------------------- */

const HEADINGS = [H1, H2, H3, H4, H5, H6];

/**
 * Headings are sized against the 13px body rather than against the document.
 * A comment is not a page, and an `#` in one means "this is a section of my
 * comment", not "this outranks the issue title".
 */
const HEADING_CLASS = [
	"mt-4 mb-2 text-[16px] font-semibold",
	"mt-4 mb-2 text-[15px] font-semibold",
	"mt-3 mb-1 text-[14px] font-semibold",
	"mt-3 mb-1 text-[13px] font-semibold",
	"mt-3 mb-1 text-[13px] font-semibold",
	"mt-3 mb-1 text-[13px] font-semibold text-muted-foreground",
];

function renderBlocks(blocks: Block[]): Child[] {
	return blocks.map(renderBlock);
}

function renderBlock(block: Block): Child {
	switch (block.kind) {
		case "paragraph":
			return P({ class: "my-2" }, ...inline(block.text, { depth: 0, links: true }));

		case "heading":
			return HEADINGS[block.level - 1]!(
				{ class: HEADING_CLASS[block.level - 1]! },
				...inline(block.text, { depth: 0, links: true }),
			);

		case "code":
			return Pre(
				{
					// Long lines scroll inside the block instead of stretching the
					// comment column — a pasted command should not widen the page.
					class:
						"my-2 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 text-[12px] leading-relaxed",
					// The info string is kept as a hint rather than used to
					// highlight: there is no highlighter here, and a class named
					// after the language is what one would look for later.
					"data-language": block.language === "" ? undefined : block.language,
				},
				Code({ class: "font-mono" }, block.text),
			);

		case "list": {
			const spacing = block.loose ? "my-2 space-y-2 pl-5" : "my-2 space-y-1 pl-5";
			const children = block.items.map((item) => renderItem(item, block.loose));
			return block.ordered
				? Ol(
						{
							class: cn("list-decimal", spacing),
							// `3.` at the top of a list means the list starts at three.
							start: block.start === 1 ? undefined : block.start,
						},
						...children,
					)
				: Ul({ class: cn("list-disc", spacing) }, ...children);
		}

		case "quote":
			return Blockquote(
				{ class: "my-2 border-l-2 border-border pl-3 text-muted-foreground" },
				...renderBlocks(block.blocks),
			);

		case "rule":
			return Hr({ class: "my-3 border-border" });
	}
}

/**
 * A tight item's leading paragraph is unwrapped, so `- one` is one line rather
 * than a bullet with a paragraph's margins hanging off it. Whatever follows it
 * — a nested list, almost always — still renders as blocks.
 */
function renderItem(blocks: Block[], loose: boolean): Child {
	const [first, ...rest] = blocks;
	if (loose || first === undefined || first.kind !== "paragraph") {
		return Li({ class: "leading-relaxed" }, ...renderBlocks(blocks));
	}
	return Li(
		{ class: "leading-relaxed" },
		...inline(first.text, { depth: 0, links: true }),
		...renderBlocks(rest),
	);
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

interface InlineContext {
	depth: number;
	/** False inside a link's own label — an `<a>` inside an `<a>` is not a thing. */
	links: boolean;
}

const PUNCTUATION = /[\\`*_{}[\]()#+\-.!~<>|]/;
const WORD = /[\p{L}\p{N}]/u;
const BARE_URL = /^https?:\/\/[^\s<>]+/;

const CODE_CLASS =
	"rounded border border-border bg-secondary/50 px-1 py-0.5 font-mono text-[0.9em] break-words";
const LINK_CLASS = "underline underline-offset-2 hover:text-ring";

function deeper(context: InlineContext, links = context.links): InlineContext {
	return { depth: context.depth + 1, links };
}

function inline(text: string, context: InlineContext): Child[] {
	const out: Child[] = [];
	let buffer = "";
	let index = 0;

	const flush = () => {
		if (buffer !== "") {
			out.push(buffer);
			buffer = "";
		}
	};

	// Past the nesting limit the rest is text. Emphasis inside emphasis inside
	// emphasis is not a thing a comment does, but it is a thing a body can say.
	if (context.depth >= MAX_DEPTH) return [text];

	while (index < text.length) {
		const char = text[index]!;

		if (char === "\\" && index + 1 < text.length && PUNCTUATION.test(text[index + 1]!)) {
			buffer += text[index + 1]!;
			index += 2;
			continue;
		}

		// A single newline inside a paragraph is a line break, which is how the
		// bodies written against the old plain-text rendering read.
		if (char === "\n") {
			flush();
			out.push(Br());
			index++;
			continue;
		}

		if (char === "`") {
			const span = codeSpan(text, index);
			if (span !== null) {
				flush();
				out.push(Code({ class: CODE_CLASS }, span.text));
				index = span.end;
				continue;
			}
		}

		if (char === "[" || (char === "!" && text[index + 1] === "[")) {
			const link = linkAt(text, index);
			if (link !== null) {
				flush();
				out.push(renderLink(link, context));
				index = link.end;
				continue;
			}
		}

		if (char === "<") {
			const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(text.slice(index));
			if (auto !== null) {
				flush();
				out.push(renderTarget(auto[1]!, [auto[1]!], context));
				index += auto[0].length;
				continue;
			}
		}

		if (char === "*" || char === "_" || char === "~") {
			const emphasis = emphasisAt(text, index, context);
			if (emphasis !== null) {
				flush();
				out.push(emphasis.node);
				index = emphasis.end;
				continue;
			}
		}

		// A pasted URL is a link. Only at a word boundary, so the `http` in
		// `xhttp://` is not one.
		if (char === "h" && !WORD.test(text[index - 1] ?? "")) {
			const bare = BARE_URL.exec(text.slice(index));
			if (bare !== null) {
				const url = trimTrailing(bare[0]);
				if (url.length > "https://".length) {
					flush();
					out.push(renderTarget(url, [url], context));
					index += url.length;
					continue;
				}
			}
		}

		buffer += char;
		index++;
	}

	flush();
	return out;
}

/**
 * Sentence punctuation after a pasted URL belongs to the sentence.
 *
 * A closing paren only ends the URL if the URL opened one — which is what
 * keeps a wikipedia `(disambiguation)` link intact inside `(see …)`.
 */
function trimTrailing(url: string): string {
	let end = url.length;
	while (end > 0) {
		const last = url[end - 1]!;
		if (/[.,;:!?'"]/.test(last)) {
			end--;
			continue;
		}
		if (last === ")") {
			const slice = url.slice(0, end);
			const opened = slice.split("(").length - 1;
			const closed = slice.split(")").length - 1;
			if (closed > opened) {
				end--;
				continue;
			}
		}
		break;
	}
	return url.slice(0, end);
}

/**
 * A backtick run and its matching close.
 *
 * The run length has to match exactly, which is the rule that lets `` `a` ``
 * appear inside a doubled span.
 */
function codeSpan(text: string, start: number): { text: string; end: number } | null {
	let open = start;
	while (text[open] === "`") open++;
	const length = open - start;

	let cursor = open;
	while (cursor < text.length) {
		if (text[cursor] !== "`") {
			cursor++;
			continue;
		}
		let close = cursor;
		while (text[close] === "`") close++;
		if (close - cursor === length) {
			let content = text.slice(open, cursor).replace(/\n/g, " ");
			// One space either side is stripped, so `` ` `` can hold a backtick.
			if (content.length > 2 && content.startsWith(" ") && content.endsWith(" ")) {
				if (content.trim() !== "") content = content.slice(1, -1);
			}
			return { text: content, end: close };
		}
		cursor = close;
	}
	return null;
}

interface LinkMatch {
	image: boolean;
	label: string;
	target: string;
	end: number;
}

function linkAt(text: string, start: number): LinkMatch | null {
	const image = text[start] === "!";
	let index = start + (image ? 2 : 1);
	if (text[index - 1] !== "[") return null;

	const labelStart = index;
	let brackets = 1;
	while (index < text.length) {
		const char = text[index]!;
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === "[") brackets++;
		if (char === "]") {
			brackets--;
			if (brackets === 0) break;
		}
		index++;
	}
	if (brackets !== 0) return null;

	const label = text.slice(labelStart, index);
	index++;
	if (text[index] !== "(") return null;
	index++;

	const targetStart = index;
	let parens = 1;
	while (index < text.length) {
		const char = text[index]!;
		if (char === "\\") {
			index += 2;
			continue;
		}
		// A destination does not span lines; a `[` on its own does not open one.
		if (char === "\n") return null;
		if (char === "(") parens++;
		if (char === ")") {
			parens--;
			if (parens === 0) break;
		}
		index++;
	}
	if (parens !== 0) return null;

	let target = text.slice(targetStart, index).trim();
	index++;

	// `(<url>)` and `(url "title")` — the title is dropped, since it would only
	// ever surface as a tooltip and the URL is the more useful one there.
	if (target.startsWith("<")) {
		const close = target.indexOf(">");
		target = close === -1 ? target.slice(1) : target.slice(1, close);
	} else {
		const space = target.search(/\s/);
		if (space !== -1) target = target.slice(0, space);
	}

	return { image, label, target, end: index };
}

function renderLink(link: LinkMatch, context: InlineContext): Child {
	// `[@src/lib/foo.ts](url)` is what the `@` menu inserts. Recognised here so
	// a mention keeps its pill wherever a body is rendered, rather than the
	// mention overlay and this being two ways to draw the same thing.
	if (!link.image && link.label.startsWith("@") && link.label.length > 1) {
		const url = safeUrl(link.target);
		if (url !== null) return MentionLink(link.label.slice(1), url);
	}

	// Images are deliberately not `<img>`: a body that can load an arbitrary
	// remote URL is a body that can report who read it, and pictures on a
	// comment already have a home in the attachment grid. The link keeps the
	// content reachable without the page fetching anything on its own.
	const label = link.label === "" ? link.target : link.label;
	if (link.image) return renderTarget(link.target, [label], context);

	return renderTarget(link.target, inline(label, deeper(context, false)), context);
}

/** A link, or its own label as plain text when the target is not allowed. */
function renderTarget(target: string, label: Child[], context: InlineContext): Child {
	const url = safeUrl(target);
	if (url === null || !context.links) return Span({ class: "contents" }, ...label);

	return A(
		{
			href: url,
			target: "_blank",
			// Bodies are written by anyone with an account and by agents, so
			// outbound links carry the full set: no referrer, no window handle,
			// and no endorsement.
			rel: "noreferrer noopener nofollow ugc",
			class: LINK_CLASS,
			title: url,
		},
		...label,
	);
}

/**
 * `**bold**`, `*italic*`, `***both***`, `~~struck~~`.
 *
 * `_` is held to a word-boundary rule that `*` is not, because
 * `SOME_CONSTANT_NAME` is a thing people write in comments and italicising its
 * middle is never what they meant.
 */
function emphasisAt(
	text: string,
	start: number,
	context: InlineContext,
): { node: Child; end: number } | null {
	const char = text[start]!;

	if (char === "~") {
		if (text[start + 1] !== "~") return null;
		const close = findClose(text, start + 2, "~~");
		if (close === -1 || close === start + 2) return null;
		return {
			node: Del({ class: "opacity-70" }, ...inline(text.slice(start + 2, close), deeper(context))),
			end: close + 2,
		};
	}

	let run = start;
	while (text[run] === char && run - start < 3) run++;
	const length = run - start;

	// `** bold**` is not emphasis; the run has to butt up against the content.
	if (run >= text.length || /\s/.test(text[run]!)) return null;
	if (char === "_" && WORD.test(text[start - 1] ?? "")) return null;

	const marker = char.repeat(length);
	const close = findClose(text, run, marker);
	if (close === -1) return null;

	const inner = inline(text.slice(run, close), deeper(context));
	const node =
		length === 1
			? Em({ class: "italic" }, ...inner)
			: length === 2
				? Strong({ class: "font-semibold" }, ...inner)
				: Strong({ class: "font-semibold" }, Em({ class: "italic" }, ...inner));

	return { node, end: close + length };
}

/** The closing run for `marker`, skipping code spans and escapes. */
function findClose(text: string, from: number, marker: string): number {
	const char = marker[0]!;
	let index = from;

	while (index < text.length) {
		const current = text[index]!;

		if (current === "\\") {
			index += 2;
			continue;
		}
		if (current === "`") {
			const span = codeSpan(text, index);
			if (span !== null) {
				index = span.end;
				continue;
			}
		}
		if (text.startsWith(marker, index)) {
			const before = text[index - 1] ?? " ";
			const after = text[index + marker.length];
			const exact = after !== char;
			const wordSafe = char !== "_" || after === undefined || !WORD.test(after);
			if (!/\s/.test(before) && exact && wordSafe) return index;

			// Step over the whole run, so a longer one is not re-examined
			// character by character.
			let run = index;
			while (text[run] === char) run++;
			index = run;
			continue;
		}
		index++;
	}

	return -1;
}
