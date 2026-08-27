/**
 * The markdown in a body box, styled where it is written.
 *
 * The composer used to keep its rendering behind a Preview tab, which is two
 * views of one field: you wrote in one and checked your work in the other, and
 * the caret, the scroll position and the `@` menu all had to be handed back
 * across the switch. This paints the styling onto the text instead, as it is
 * typed — the box is the preview.
 *
 * # Why this is not the markdown renderer
 *
 * These nodes are an overlay. They sit on top of a live textarea whose own text
 * is transparent, so every glyph has to land exactly where the character
 * underneath it does — the caret, the selection and the `@` menu's coordinates
 * are all the textarea's, measured against the raw characters.
 *
 * That rules out everything that changes the shape of the text: a bigger
 * heading, an indented list, a padded code pill, and `**bold**` collapsing to
 * four fewer characters. It also rules out the two properties you would reach
 * for first — `font-weight` and `font-style` — because each picks a different
 * face, a different set of glyph advances, and a line that drifts out from
 * under the caret a few characters in. Bold is drawn as a text shadow instead,
 * which thickens a glyph without moving the next one; emphasis keeps the
 * weight it has and is marked by its dimmed `*`s alone.
 *
 * What is left — colour, background, `text-decoration`, that shadow — is
 * enough to read structure by, and every one of them is free. Markers stay on
 * screen, dimmed rather than deleted: the text you see is the text you are
 * editing, which is the whole reason the composer is still a textarea.
 *
 * lib/components/markdown.ts renders posted bodies, where there is no textarea
 * to line up with and none of this applies.
 */
import { Dynamic, Span, type Child, type Readable } from "@implementjs/core";
import { highlightCode } from "@/lib/components/highlight";

/**
 * Past this, the body is drawn plain. This runs on every keystroke, and a
 * pasted megabyte should cost the box its colours, not a frame.
 */
const MAX_DECORATED_LENGTH = 20_000;

/** Emphasis inside emphasis inside emphasis; past here the rest is text. */
const MAX_DEPTH = 4;

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Syntax that is still on screen but is not the content: `#`, `**`, `>`, the
 * `](url)` half of a link. Dim enough to read past, solid enough to edit.
 */
const MARKER = "text-muted-foreground/60";

/**
 * Faux bold. `font-weight` would pick a heavier face and a wider line;
 * smearing the glyph a third of a pixel sideways costs no layout at all.
 */
const STRONG = "text-foreground [text-shadow:0.35px_0_0_currentColor]";

const STRIKE = "line-through";
const LINK = "text-ring underline underline-offset-2";
/** No padding and no border — both would push the next character along. */
const CODE = "rounded bg-secondary/60 text-foreground";
const CODE_BLOCK = "rounded bg-secondary/40";
const QUOTE = "text-muted-foreground";
const LIST_MARKER = "text-ring";

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

// The same shapes lib/components/markdown.ts parses and markdown-commands.ts
// writes, matched here as whole lines so the marker can be split off the
// content it marks.
const FENCE = /^ {0,3}(```+|~~~+)[ \t]*([^`\n]*)$/;
const HEADING = /^( {0,3}#{1,6}[ \t]+)(.*)$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTED = /^( {0,3}> ?)(.*)$/;
const ITEM = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)(.*)$/;

/**
 * Renders a body's markdown as styled spans, character for character.
 *
 * Every character of `source` comes out somewhere in the result, in the order
 * it went in — that is the contract the overlay is built on, and the reason
 * this returns nodes for the source rather than for what the source means.
 */
export function decorate(source: string): Child[] {
	if (source.length > MAX_DECORATED_LENGTH) return [source];

	const out: Child[] = [];
	const lines = source.split("\n");
	let index = 0;

	while (index < lines.length) {
		// The newline that separated this line from the last one. Lines are
		// emitted whole (a fenced block, several at a time), so the separator is
		// put back here rather than after each one.
		if (index > 0) out.push("\n");

		const line = lines[index]!;
		const fence = FENCE.exec(line);
		if (fence === null) {
			out.push(...decorateLine(line));
			index++;
			continue;
		}

		// A fenced block, from its opening fence to the first line that closes it
		// on the same character — the rule that keeps a ```ts inside a ```` block
		// content. An unclosed fence runs to the end, which is what a block being
		// typed looks like.
		const marker = fence[1]![0]!;
		const width = fence[1]!.length;
		const body: string[] = [];
		let end = index + 1;
		while (end < lines.length) {
			const closing = FENCE.exec(lines[end]!);
			if (
				closing !== null &&
				closing[1]![0] === marker &&
				closing[1]!.length >= width &&
				closing[2]!.trim() === ""
			) {
				break;
			}
			body.push(lines[end]!);
			end++;
		}

		out.push(Span({ class: MARKER }, line));
		if (body.length > 0) {
			// Highlighted as one block rather than line by line: a string or a
			// comment that spans lines is one token, and a per-line pass would cut
			// it in half. `highlightCode` only ever sets colours, so it cannot move
			// a character out from under the caret.
			out.push(
				"\n",
				Span({ class: CODE_BLOCK }, ...highlightCode(fence[2]!.trim(), body.join("\n"))),
			);
		}
		if (end < lines.length) {
			out.push("\n", Span({ class: MARKER }, lines[end]!));
			end++;
		}
		index = end;
	}

	return out;
}

/** A body's markdown, restyled as the body changes. */
export function DecoratedText(body: Readable<string>, className?: string) {
	return Span(
		{ class: className },
		Dynamic([body], (text) => Span({ class: "contents" }, ...decorate(text))),
	);
}

function decorateLine(line: string): Child[] {
	if (RULE.test(line)) return [Span({ class: MARKER }, line)];

	const heading = HEADING.exec(line);
	if (heading !== null) {
		// The `#`s cannot make the line bigger without moving it, so the weight
		// carries the heading on its own.
		return [
			Span({ class: MARKER }, heading[1]!),
			Span({ class: STRONG }, ...inline(heading[2]!, 0)),
		];
	}

	const quoted = QUOTED.exec(line);
	if (quoted !== null) {
		return [Span({ class: MARKER }, quoted[1]!), Span({ class: QUOTE }, ...inline(quoted[2]!, 0))];
	}

	const item = ITEM.exec(line);
	if (item !== null) {
		return [Span({ class: LIST_MARKER }, item[1]!), ...inline(item[2]!, 0)];
	}

	return inline(line, 0);
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

const PUNCTUATION = /[\\`*_{}[\]()#+\-.!~<>|]/;
const WORD = /[\p{L}\p{N}]/u;
const BARE_URL = /^https?:\/\/[^\s<>]+/;
const AUTOLINK = /^<(?:https?:\/\/|mailto:)[^\s<>]+>/;

/**
 * One line's inline markup.
 *
 * Deliberately a looser reading than the renderer's: this decides how a
 * character is coloured, so a span it declines to see stays plain text and
 * nothing is lost. The renderer decides what a posted body says, and is strict
 * for that reason.
 */
function inline(text: string, depth: number): Child[] {
	if (depth >= MAX_DEPTH) return [text];

	const out: Child[] = [];
	let buffer = "";
	let index = 0;

	const flush = () => {
		if (buffer !== "") {
			out.push(buffer);
			buffer = "";
		}
	};

	while (index < text.length) {
		const char = text[index]!;

		// An escape is two characters that mean one; both stay, dimmed together,
		// so the `*` that is not emphasis does not look like emphasis that failed.
		if (char === "\\" && index + 1 < text.length && PUNCTUATION.test(text[index + 1]!)) {
			flush();
			out.push(Span({ class: MARKER }, text.slice(index, index + 2)));
			index += 2;
			continue;
		}

		if (char === "`") {
			const end = codeSpan(text, index);
			if (end !== -1) {
				flush();
				// Backticks and all: the block they tint is the text as it is stored.
				out.push(Span({ class: CODE }, text.slice(index, end)));
				index = end;
				continue;
			}
		}

		if (char === "[") {
			const link = linkAt(text, index);
			if (link !== null) {
				flush();
				out.push(
					Span({ class: MARKER }, "["),
					Span({ class: LINK }, ...inline(text.slice(link.label, link.labelEnd), depth + 1)),
					Span({ class: MARKER }, text.slice(link.labelEnd, link.end)),
				);
				index = link.end;
				continue;
			}
		}

		if (char === "<") {
			const auto = AUTOLINK.exec(text.slice(index));
			if (auto !== null) {
				flush();
				out.push(Span({ class: LINK }, auto[0]));
				index += auto[0].length;
				continue;
			}
		}

		if (char === "*" || char === "_" || char === "~") {
			const emphasis = emphasisAt(text, index, depth);
			if (emphasis !== null) {
				flush();
				out.push(...emphasis.nodes);
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
					out.push(Span({ class: LINK }, url));
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

/** Sentence punctuation after a pasted URL belongs to the sentence. */
function trimTrailing(url: string): string {
	let end = url.length;
	while (end > 0 && /[.,;:!?'")]/.test(url[end - 1]!)) end--;
	return url.slice(0, end);
}

/** The end of the code span opening at `start`, or -1 when it never closes. */
function codeSpan(text: string, start: number): number {
	let open = start;
	while (text[open] === "`") open++;
	const width = open - start;

	let cursor = open;
	while (cursor < text.length) {
		if (text[cursor] !== "`") {
			cursor++;
			continue;
		}
		let close = cursor;
		while (text[close] === "`") close++;
		// The run has to match exactly, which is what lets `` ` `` sit inside a
		// doubled span.
		if (close - cursor === width) return close;
		cursor = close;
	}
	return -1;
}

interface LinkMatch {
	/** Offsets into the line: `[` label `](` target `)`. */
	label: number;
	labelEnd: number;
	end: number;
}

/**
 * `[label](target)` starting at `start`.
 *
 * A line at a time, so there is no newline to guard against, and nested
 * brackets and parens are counted rather than matched lazily — `[a [b]](c)`
 * and a `(disambiguation)` in a URL are both things people paste.
 */
function linkAt(text: string, start: number): LinkMatch | null {
	let index = start + 1;
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

	const labelEnd = index;
	if (text[index + 1] !== "(") return null;

	index += 2;
	let parens = 1;
	while (index < text.length) {
		const char = text[index]!;
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === "(") parens++;
		if (char === ")") {
			parens--;
			if (parens === 0) break;
		}
		index++;
	}
	if (parens !== 0) return null;

	return { label: start + 1, labelEnd, end: index + 1 };
}

/**
 * `**bold**`, `*emphasis*`, `~~struck~~`, and their `_` spellings.
 *
 * Weight and strikethrough are drawn; emphasis is not, because the italic face
 * would take the line with it (see the note at the top of this file). Its
 * markers still dim, which is the same signal every other span gets.
 */
function emphasisAt(
	text: string,
	start: number,
	depth: number,
): { nodes: Child[]; end: number } | null {
	const char = text[start]!;

	if (char === "~") {
		if (text[start + 1] !== "~") return null;
		const close = findClose(text, start + 2, "~~");
		if (close === -1 || close === start + 2) return null;
		return {
			nodes: [
				Span({ class: MARKER }, "~~"),
				Span({ class: STRIKE }, ...inline(text.slice(start + 2, close), depth + 1)),
				Span({ class: MARKER }, "~~"),
			],
			end: close + 2,
		};
	}

	let run = start;
	while (text[run] === char && run - start < 3) run++;
	const width = run - start;

	// `** bold**` is not emphasis; the run has to butt up against the content.
	if (run >= text.length || /\s/.test(text[run]!)) return null;
	// `SOME_CONSTANT_NAME` is a thing people write, and italicising its middle
	// is never what they meant.
	if (char === "_" && WORD.test(text[start - 1] ?? "")) return null;

	const marker = char.repeat(width);
	const close = findClose(text, run, marker);
	if (close === -1) return null;

	const inner = inline(text.slice(run, close), depth + 1);
	// One marker is emphasis, which is drawn as nothing; two or three carry
	// weight, which is drawn.
	const content: Child[] = width === 1 ? inner : [Span({ class: STRONG }, ...inner)];
	return {
		nodes: [Span({ class: MARKER }, marker), ...content, Span({ class: MARKER }, marker)],
		end: close + width,
	};
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
			const end = codeSpan(text, index);
			if (end !== -1) {
				index = end;
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
			let end = index;
			while (text[end] === char) end++;
			index = end;
			continue;
		}
		index++;
	}

	return -1;
}
