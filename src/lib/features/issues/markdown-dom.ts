/**
 * The two directions a live markdown editor needs: markdown onto the screen,
 * and the screen back to markdown.
 *
 * The composer is a `contenteditable`, not a textarea. What you see is the
 * body as it will be posted — `**bold**` is bold, `# ` is a heading, a fenced
 * block is a highlighted block — and the markdown markers are not on screen at
 * all. The body is still stored as markdown, because everything else about it
 * (the API, the agents, the copy-prompt button, every renderer) already is.
 *
 * # How an edit works
 *
 * Every edit takes the same round trip:
 *
 *     DOM ──serialize──► markdown ──a string edit──► markdown ──render──► DOM
 *
 * Typing is the trivial case: the browser puts the character in the DOM, this
 * reads the DOM back as markdown, and the result is rendered again. Anything
 * else — Enter, Backspace over a marker, ⌘B, a pasted body, picking a file
 * from the `@` menu — is a plain string edit in the middle of that trip, which
 * is why the toolbar commands in markdown-commands.ts still work unchanged.
 *
 * The parse is the input rule. Nothing here watches for `**` or `# ` or a
 * closing backtick: the markdown is re-parsed after each keystroke, so a
 * construct becomes formatting the moment it is complete and stays text until
 * it is. One parser decides what the body means while it is being written and
 * what it means once it is posted, so the two can never disagree.
 *
 * # The caret
 *
 * A re-render replaces every node under the editor, so the selection has to be
 * carried across it. Both directions do that with a pair of sentinel
 * characters rather than by mapping offsets between the markdown and the DOM:
 * a mapping would have to be threaded through the parser and kept honest for
 * every construct, while a sentinel is just a character that flows through the
 * parse the way any other character does.
 *
 * Going in, the sentinels are put into the source, rendered, then found in the
 * text and deleted. Going out they are put into the DOM, serialized, then
 * found in the string and deleted.
 */
import { renderMarkdown, safeUrl } from "@/lib/components/markdown";
import type { Child } from "@implementjs/core";

/** A markdown body and a selection in it, in character offsets. */
export interface SourceSelection {
	value: string;
	start: number;
	end: number;
}

/**
 * Characters no keyboard produces and no body contains, so finding one is
 * proof it is ours. They also mean nothing to the parser, which is what lets
 * them ride through it.
 */
const HEAD = "";
const TAIL = "";

/* -------------------------------------------------------------------------- */
/* Markdown → DOM                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Draws `source` into `host`, replacing whatever was there.
 *
 * The nodes are the ones lib/components/markdown.ts builds for a posted body —
 * the same elements, the same classes, the same highlighter — so the editor is
 * not a second opinion about what the body looks like.
 */
export function paint(host: HTMLElement, source: string): void {
	host.replaceChildren();
	for (const child of renderMarkdown(source)) attach(host, child);

	// An empty body still needs a line to put the caret on, and a paragraph
	// with nothing in it needs a `<br>` before a browser will let you stand in
	// it. The serializer knows to ignore both.
	if (host.firstChild === null) host.append(paragraph());
	for (const block of host.children) {
		if (block.tagName === "P" && block.firstChild === null)
			block.append(document.createElement("br"));
	}

	// A mention is one thing, not a word to be edited letter by letter — whether
	// it names a file or a person.
	for (const pill of host.querySelectorAll("[data-mention-path], [data-mention-user]")) {
		(pill as HTMLElement).contentEditable = "false";
	}
}

function paragraph(): HTMLElement {
	const node = document.createElement("p");
	node.className = "my-2";
	return node;
}

function attach(host: HTMLElement, child: Child): void {
	// A mountable is a function; `renderMarkdown` returns those and strings,
	// and nothing else.
	if (typeof child === "function") {
		child().mount(host);
		return;
	}
	if (typeof child === "string") host.append(document.createTextNode(child));
}

/**
 * Draws `selection.value` into `host` and puts the selection back where the
 * offsets say, as far as the rendered body allows.
 */
export function render(host: HTMLElement, selection: SourceSelection, force = true): boolean {
	const source = marked(selection);

	// Nowhere on screen for the caret to stand. After a keystroke the browser
	// has already drawn the character where it belongs, so the kindest answer
	// is to leave the DOM alone and try again on the next one — the markdown is
	// right either way, it is only the drawing that waits. After an edit this
	// made up itself (Enter, a command, a paste) there is nothing on screen yet
	// to leave alone, so it draws and takes the end of the body as the caret.
	if (source === null) {
		if (!force) return false;
		paint(host, selection.value);
		const range = document.createRange();
		range.selectNodeContents(host);
		range.collapse(false);
		const fallback = window.getSelection();
		fallback?.removeAllRanges();
		fallback?.addRange(range);
		return true;
	}

	const scroll = host.scrollTop;
	paint(host, source);

	const tail = find(host, TAIL);
	const head = find(host, HEAD);
	// The end goes first, since taking out the start would move it.
	let tailAt = tail === null ? null : lift(tail);
	const headAt = head === null ? null : lift(head);
	// Unless they landed in the same run of text, where taking out the start
	// moves the end anyway — a selection inside one word, which is most of them.
	if (tailAt !== null && headAt !== null && tailAt.node === headAt.node) {
		tailAt = { node: tailAt.node, offset: Math.max(headAt.offset, tailAt.offset - 1) };
	}

	host.scrollTop = scroll;

	if (headAt === null) return true;
	const range = document.createRange();
	range.setStart(headAt.node, headAt.offset);
	if (tailAt === null) range.collapse(true);
	else range.setEnd(tailAt.node, tailAt.offset);

	const current = window.getSelection();
	current?.removeAllRanges();
	current?.addRange(range);
	return true;
}

/**
 * `value` with the sentinels in it, at the first offsets that leave the body
 * meaning what it meant without them.
 *
 * A sentinel dropped in the middle of a marker stops that marker being one:
 * `\x01## Title` is a paragraph that starts with two hashes, and rendering it
 * would show the `##` that the heading had swallowed. Rather than teach this
 * about markers, it renders and looks — if the text on screen gained
 * characters, the caret is standing in a marker, and the fix is to step past
 * it. Stepping forward lands it at the start of the content, which is where a
 * caret at the head of a heading belongs anyway.
 */
function marked(selection: SourceSelection): string | null {
	const { value } = selection;
	if (selection.start < 0) return value;

	const probe = document.createElement("div");
	paint(probe, value);
	const plain = probe.textContent ?? "";

	for (let nudge = 0; nudge <= MAX_NUDGE; nudge++) {
		const head = Math.min(selection.start + nudge, value.length);
		const tail = Math.min(Math.max(selection.end + nudge, head), value.length);
		const candidate =
			head === tail
				? value.slice(0, head) + HEAD + value.slice(head)
				: value.slice(0, head) + HEAD + value.slice(head, tail) + TAIL + value.slice(tail);

		paint(probe, candidate);
		const drawn = probe.textContent ?? "";
		// Three ways a placement can be wrong, and all of them mean the caret is
		// standing in markup rather than in the body: the sentinel is not on
		// screen at all, it is on screen but inside an attribute — the target of
		// a link, where it is neither visible nor selectable — or the text
		// around it gained the characters a marker it broke had been hiding.
		if (!drawn.includes(HEAD)) continue;
		if (attributed(probe)) continue;
		if (drawn.replaceAll(HEAD, "").replaceAll(TAIL, "") === plain) return candidate;
	}
	return null;
}

/** Whether a sentinel ended up somewhere only the DOM can see. */
function attributed(probe: HTMLElement): boolean {
	for (const element of probe.querySelectorAll("*")) {
		for (const attribute of element.attributes) {
			if (attribute.value.includes(HEAD) || attribute.value.includes(TAIL)) return true;
		}
	}
	return false;
}

/** Six `#`, a space, and the sentinel itself. */
const MAX_NUDGE = 8;

/** What a browser writes into the document when a typed space would collapse. */
const NBSP = "\u00a0";

/**
 * A character to stand the caret on where there is otherwise no text to stand
 * on: right after a `<strong>` at the end of a line, most often.
 *
 * A text node with nothing in it is not a place as far as a browser is
 * concerned \u2014 it collapses the caret into whatever came before, and the space
 * you type after finishing `**bold**` goes *inside* the bold and stops it
 * being bold at all. A zero-width space is a real character in a real text
 * node, so the caret stays outside where it was put; the serializer drops
 * every one of them on the way back, so none of this reaches the body.
 */
const ANCHOR = "\u200b";

/**
 * Replaces a sentinel with the position it stood for, keeping the text node
 * inhabitable if the sentinel was all it held.
 */
function lift(found: { node: Text; offset: number }): { node: Text; offset: number } {
	found.node.deleteData(found.offset, 1);
	if (found.node.data !== "") return found;
	found.node.data = ANCHOR;
	return { node: found.node, offset: 1 };
}

function find(host: HTMLElement, char: string): { node: Text; offset: number } | null {
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node !== null) {
		const offset = (node as Text).data.indexOf(char);
		if (offset !== -1) return { node: node as Text, offset };
		node = walker.nextNode();
	}
	return null;
}

/* -------------------------------------------------------------------------- */
/* DOM → markdown                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reads `host` back as markdown, with the live selection as offsets into it.
 *
 * The selection rides along as sentinel characters written into the DOM before
 * the walk and taken out of the string after it, so the walk itself is a plain
 * recursive join with no offsets to keep straight through nesting, prefixes
 * and escapes.
 */
export function serialize(host: HTMLElement): SourceSelection {
	const planted = plant(host);
	const marked = blocks([...host.childNodes]);
	for (const node of planted) node.remove();

	const head = marked.indexOf(HEAD);
	const withoutHead = marked.replace(HEAD, "");
	const tail = withoutHead.indexOf(TAIL);
	const value = withoutHead.replace(TAIL, "");

	return {
		value,
		start: head,
		end: tail === -1 ? head : tail,
	};
}

/**
 * Whether there is anything in the editor but the scaffolding.
 *
 * Deleting text does not delete the block that held it: select everything in a
 * heading, press Backspace, and what is left is an empty `<h1>` that the
 * serializer faithfully writes back as `# `. Nobody typed that marker and
 * nothing on screen shows it, so a caller that has just deleted asks this
 * rather than believing the round trip.
 */
export function isBlank(host: HTMLElement): boolean {
	const text = (host.textContent ?? "").replaceAll(ANCHOR, "").replaceAll(NBSP, " ");
	return text.trim() === "";
}

/**
 * Writes the selection into the DOM as two characters, and hands back the
 * nodes to take out again. Nodes rather than positions: a text node the walk
 * has already passed cannot be edited back, so the sentinels are removed after
 * the string is built.
 */
function plant(host: HTMLElement): Text[] {
	const selection = window.getSelection();
	if (selection === null || selection.rangeCount === 0) return [];

	const range = selection.getRangeAt(0);
	if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return [];

	// The end goes in first: inserting at the start would move it.
	const planted: Text[] = [];
	if (!range.collapsed) planted.push(insert(range.endContainer, range.endOffset, TAIL));
	planted.push(insert(range.startContainer, range.startOffset, HEAD));
	return planted;
}

function insert(container: Node, offset: number, char: string): Text {
	const node = document.createTextNode(char);
	if (container.nodeType === Node.TEXT_NODE) {
		const text = container as Text;
		text.splitText(Math.min(offset, text.length)).before(node);
		return node;
	}
	const after = container.childNodes[offset] ?? null;
	if (after === null) container.appendChild(node);
	else container.insertBefore(node, after);
	return node;
}

/**
 * The block-level children of one container, as markdown.
 *
 * `gap` is what goes between them. A blank line everywhere except inside a
 * tight list item, where a blank line is exactly what would make the list
 * loose — the nested list under an item has to hang off the line above it,
 * not sit a paragraph away from it.
 */
function blocks(nodes: Node[], gap = "\n\n"): string {
	const parts: string[] = [];
	for (const node of nodes) {
		const text = block(node);
		// A paragraph with nothing in it is the blank line the join already
		// writes; keeping it would stack up blank lines as they were typed.
		if (text !== "") parts.push(text);
	}
	return parts.join(gap);
}

const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const BLOCKS = new Set(["P", "DIV", "UL", "OL", "LI", "PRE", "BLOCKQUOTE", "HR", ...HEADINGS]);

function block(node: Node): string {
	if (node.nodeType !== Node.ELEMENT_NODE) return inline(node);

	const element = node as HTMLElement;
	const tag = element.tagName;

	if (HEADINGS.has(tag)) {
		const level = Number.parseInt(tag.slice(1), 10);
		return `${"#".repeat(level)} ${children(element)}`;
	}

	switch (tag) {
		case "HR":
			return "---";

		case "PRE":
			return fence(element);

		case "BLOCKQUOTE":
			// Blank lines are quoted too: the `>` on the gap is what keeps a
			// two-paragraph quote one quote.
			return prefix(content(element), "> ", "> ");

		case "UL":
		case "OL":
			return list(element);

		case "BR":
			return "";

		// A `<p>` holds a run of text; a `<div>` is what a browser reaches for
		// when it has to wrap something mid-edit and could hold either.
		default:
			return content(element);
	}
}

/**
 * What is inside an element: blocks if it holds any, otherwise one run of text.
 *
 * The distinction has to be made from the element's contents rather than from
 * its tag, because the same tag holds both. A list item is a line in a tight
 * list and a stack of paragraphs in a loose one, and while an item is being
 * typed it is whatever the browser last left in it — a run of text nodes it
 * split around an edit, most often, which read as one line and would read as
 * several paragraphs if each were taken for a block of its own.
 */
function content(element: Element, gap = "\n\n"): string {
	const nested = [...element.childNodes].some(
		(child) => child.nodeType === Node.ELEMENT_NODE && BLOCKS.has((child as Element).tagName),
	);
	return nested ? blocks([...element.childNodes], gap) : children(element);
}

function list(element: HTMLElement): string {
	const items = [...element.children].filter((child) => child.tagName === "LI");
	// A list whose items hold paragraphs is the loose kind, which is written
	// with a blank line between items and reads back as the same list.
	const loose = items.some((item) => item.querySelector(":scope > p") !== null);
	const ordered = element.tagName === "OL";
	const first = Number.parseInt(element.getAttribute("start") ?? "1", 10) || 1;

	const written = items.map((item, index) => {
		const marker = ordered ? `${first + index}. ` : "- ";
		const body = content(item, loose ? "\n\n" : "\n");
		// The marker sits on the first line; everything under it is indented to
		// the column the text starts in, which is what keeps a nested list
		// nested and a second paragraph inside the item.
		return prefix(body, marker, " ".repeat(marker.length));
	});

	return written.join(loose ? "\n\n" : "\n");
}

function fence(element: HTMLElement): string {
	const language = element.getAttribute("data-language") ?? "";
	const code = (element.textContent ?? "").replaceAll(NBSP, " ").replaceAll(ANCHOR, "");
	// A block that contains a fence needs a longer one around it.
	let width = 3;
	for (const line of code.split("\n")) {
		const run = /^ {0,3}(`+)/.exec(line);
		if (run !== null) width = Math.max(width, run[1]!.length + 1);
	}
	const rail = "`".repeat(width);
	return `${rail}${language}\n${code}\n${rail}`;
}

/**
 * Puts `first` on the first line of `text` and `rest` on the others.
 *
 * A blank line gets the prefix with its trailing space trimmed off, so a
 * quoted gap is `>` rather than `> ` — the same line, without the whitespace
 * nobody wants in the stored body.
 */
function prefix(text: string, first: string, rest: string): string {
	return text
		.split("\n")
		.map((line, index) => {
			const marker = index === 0 ? first : rest;
			return line === "" ? marker.trimEnd() : marker + line;
		})
		.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

function children(node: Node): string {
	const nodes = [...node.childNodes];
	// A block that ends in a `<br>` ends in the one browsers keep at the end of
	// an editable line so that the line has a height. It is scaffolding, not a
	// line break the author asked for.
	const last = nodes.at(-1);
	if (last !== undefined && last.nodeName === "BR") nodes.pop();

	let out = "";
	for (const child of nodes) out += inline(child);
	return out;
}

function inline(node: Node): string {
	// A space typed where one would collapse is written into the document as a
	// non-breaking space. That is the browser keeping the line looking right,
	// not the author asking for a different character.
	if (node.nodeType === Node.TEXT_NODE)
		return (node as Text).data.replaceAll(NBSP, " ").replaceAll(ANCHOR, "");
	if (node.nodeType !== Node.ELEMENT_NODE) return "";

	const element = node as HTMLElement;
	switch (element.tagName) {
		case "BR":
			// A single newline inside a paragraph is a line break, which is what
			// the renderer turned this into on the way here.
			return "\n";

		case "STRONG":
		case "B":
			return wrap(children(element), "**");

		case "EM":
		case "I":
			return wrap(children(element), "*");

		case "DEL":
		case "S":
		case "STRIKE":
			return wrap(children(element), "~~");

		case "CODE":
			return code(element.textContent ?? "");

		case "A":
			return link(element);

		default:
			return children(element);
	}
}

/** Nothing to emphasise is nothing to write — `****` is four asterisks. */
function wrap(text: string, marker: string): string {
	return text === "" ? "" : `${marker}${text}${marker}`;
}

function code(text: string): string {
	if (text === "") return "";
	// The run has to be longer than any run inside it, and a span that starts
	// or ends with a backtick needs the spaces the parser strips back off.
	let width = 1;
	for (const run of text.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1);
	const rail = "`".repeat(width);
	const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${rail}${padding}${text}${padding}${rail}`;
}

function link(element: HTMLElement): string {
	const href = element.getAttribute("href") ?? "";
	const label = children(element);
	if (href === "" || safeUrl(href) === null) return label;

	// `[@src/lib/foo.ts](url)` is what the `@` menu inserts and what the pill
	// on screen is drawn from; the path it shows is only the file's name.
	const path = element.getAttribute("data-mention-path");
	if (path !== null) return `[@${path}](${href})`;

	// A person's pill shows the whole label, but it is read off the element for
	// the same reason: what is drawn is `@name`, and the `@` belongs to the
	// syntax rather than to the name.
	const mentioned = element.getAttribute("data-mention-user");
	if (mentioned !== null) return `[@${mentioned}](${href})`;

	// A pasted URL renders as itself, so writing it back with brackets around
	// it would add punctuation the author never typed.
	if (label === href) return href;
	return `[${label}](${href})`;
}
