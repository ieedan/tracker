/**
 * The box an issue body or comment is written in.
 *
 * One component, used by the create dialog, the issue page, and the comment
 * box, so the three cannot drift apart: the same classes, the same `@` wiring,
 * the same keys.
 *
 * It is a live markdown editor, not a textarea and not a preview of one. What
 * is on screen is the body as it will be posted — `**bold**` is bold, `# ` is
 * a heading, a fenced block is a highlighted block — and the markers are not
 * drawn at all, because the moment a construct is complete it stops being
 * text. The body is still *stored* as markdown; the round trip that keeps
 * those two facts compatible lives in markdown-dom.ts, and is worth reading
 * before changing anything here.
 *
 * Everything an edit can be is a string edit on that markdown:
 *
 * - typing, which the browser does to the DOM and this reads back;
 * - Enter, Backspace over a marker and Tab, which continue or undo the
 *   markdown the caret is standing in;
 * - ⌘B, ⌘I, ⌘E and ⌘K, which run the same commands the box has always had;
 * - a paste, which is markdown the moment it lands;
 * - a person or a file picked from the `@` menu.
 *
 * There is no formatting toolbar. Markdown typed into the box turns into
 * formatting as it is written, which is the whole point of the thing — a row
 * of buttons that write the characters for you is a second way to do what
 * typing already does.
 */
import {
	Div,
	If,
	ImplementEffect,
	ImplementLifecycle,
	P,
	derived,
	isReadable,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { filesFromClipboard } from "@/lib/features/attachments/file-drop";
import { BODY_TEXT_CLASS, renderMarkdown } from "@/lib/components/markdown";
import { cn } from "@/lib/utils";
import { warmMembers } from "./member-cache";
import { MentionMenu, bodyMentions } from "./mentions";
import { insertLink, toggleWrap, type SelectionState } from "./markdown-commands";
import { isBlank, paint, render, serialize, type SourceSelection } from "./markdown-dom";

/**
 * How a body reads, in one place.
 *
 * The same size, leading and margin rules a posted body is drawn with, so the
 * text does not move when a draft becomes a comment.
 */
export const bodyComposerClass = cn(
	// 16px on a phone, and the same 13px as a posted body from `md` up. Below
	// 16 the caret landing in here zooms the whole page on iOS — see
	// `BODY_TEXT_CLASS`, which both this and the posted body take it from.
	BODY_TEXT_CLASS,
	// `pre-wrap` where a posted body collapses its whitespace: a space typed at
	// the end of a line has to stay on screen and hold the caret's place, or
	// the space you just pressed is one the box appears to have swallowed.
	"w-full leading-relaxed break-words whitespace-pre-wrap outline-none [&>:first-child]:mt-0 [&>:last-child]:mb-0",
);

export interface BodyComposerOptions {
	/** The body being written, as markdown. Two-way: editing writes into it. */
	value: Signal<string>;
	slug: () => string;
	/** Which repository `@`'s file half searches, when the issue has one. */
	repository: () => string | undefined;
	placeholder?: string;
	/** The box's minimum height, in lines. */
	rows?: number;
	/** Grow with the text instead of scrolling inside a capped box. */
	autoGrow?: boolean;
	/**
	 * Take the height the parent has left instead of the one `rows` asks for,
	 * scrolling inside it. For a caller that owns the height — the expanded
	 * create dialog — where `rows` is only the collapsed minimum.
	 *
	 * Reactive so a toggle can flip it in place: remounting the box would throw
	 * away the undo history along with the caret.
	 */
	fill?: boolean | Readable<boolean>;
	autofocus?: boolean;
	class?: string;
	/** Handed out so a caller can focus the box or tell whether it has focus. */
	element?: Signal<HTMLElement | null>;
	/** ⌘⏎. */
	onSubmit?: () => void;
	/** Not called while the mention menu is open — picking from it blurs. */
	onBlur?: () => void;
	onEscape?: () => void;
}

/** Puts the caret at the end of a body, which is where one is carried on from. */
export function focusBody(node: HTMLElement): void {
	node.focus();
	const range = document.createRange();
	range.selectNodeContents(node);
	range.collapse(false);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

export function BodyComposer(options: BodyComposerOptions) {
	const host = options.element ?? signal<HTMLElement | null>(null);
	const empty = options.value.bind((text) => text.trim() === "");

	/**
	 * Both boxes in the chain have to opt in for a percentage height to
	 * resolve: the root, and the editor that is actually filled. Normalised to
	 * a readable here so the caller can hand over either a fixed answer or a
	 * toggle, and everything downstream only has to know about the toggle.
	 */
	const filling: Readable<boolean> = isReadable<boolean>(options.fill)
		? options.fill
		: signal(options.fill === true);
	/** Capped instead, when the caller has neither given height nor taken it. */
	const capped = derived([filling], (fills) => !fills && options.autoGrow !== true);

	/**
	 * The body as it was last drawn. An edit arriving on the signal is only
	 * this component's own if it matches — a flag would depend on when the
	 * signal notifies, and this does not.
	 */
	let drawn = options.value.get();
	/** A composition (an IME, a long-press accent) is not finished text. */
	let composing = false;

	const history = createHistory({ value: drawn, start: -1, end: -1 });

	const read = (): SourceSelection | null => {
		const node = host.get();
		return node === null ? null : serialize(node);
	};

	/**
	 * Puts a body and a caret on screen, and hands the body to the caller.
	 *
	 * Every edit ends here, including a keystroke the browser already applied:
	 * re-drawing from the markdown is what turns a finished `**bold**` into
	 * bold text, and what keeps the DOM to the shapes the serializer knows.
	 */
	const apply = (next: SourceSelection, how: { record?: boolean; typed?: boolean } = {}): void => {
		const node = host.get();
		if (node === null) return;

		// A keystroke is already on screen where the browser put it, so a caret
		// this cannot place is a reason to leave the drawing until the next one.
		// Everything else has nothing on screen yet and has to be drawn.
		render(node, next, how.typed !== true);
		if (how.record !== false) history.record(next);
		drawn = next.value;
		options.value.set(next.value);
		mentions.refresh(next.value, next.end, node);
	};

	/** An edit expressed the way the toolbar commands always expressed one. */
	const command = (transform: (state: SelectionState) => SelectionState): void => {
		const current = read();
		if (current === null || current.start < 0) return;
		apply(transform(current));
	};

	const mentions = bodyMentions({
		slug: options.slug,
		repository: options.repository,
		insert: (start, markdown) => {
			const current = read();
			if (current === null || current.start < 0) return;
			// From the `@` to the caret is the run being replaced; the trailing
			// space is so typing carries on outside the mention.
			const inserted = `${markdown} `;
			apply({
				value: current.value.slice(0, start) + inserted + current.value.slice(current.end),
				start: start + inserted.length,
				end: start + inserted.length,
			});
			host.get()?.focus();
		},
	});

	const submit = (): void => {
		options.onSubmit?.();
	};

	return Div(
		{ class: cn("relative flex flex-col", { "min-h-0 flex-1": filling }) },

		ImplementLifecycle({
			onMount: () => {
				// The people half of the `@` menu is ranked in the browser, so all it
				// needs is the list — asked for when the box appears rather than when
				// the `@` is typed, which is a round trip later than a menu opening
				// on a keystroke has to answer in.
				void warmMembers(options.slug());
				const node = host.get();
				if (node === null) return;
				paint(node, options.value.get());
				if (options.autofocus === true) focusBody(node);
			},
		}),

		/**
		 * A body set from outside the box — a posted comment clearing it, Escape
		 * putting the stored words back, a draft restored — drawn as given.
		 *
		 * Not guarded on focus. Whether an edit made elsewhere should land on
		 * what someone is in the middle of typing is a question about the body,
		 * not about the box, and the callers that can answer it already do:
		 * both the description and a comment leave their draft alone while the
		 * caret is in it. Guarding here as well only broke the resets that are
		 * deliberate — clearing after a ⌘⏎ post left the words on screen with
		 * the placeholder drawn underneath them, because the value emptied and
		 * the box never heard about it.
		 */
		ImplementEffect(
			[options.value],
			(text) => {
				const node = host.get();
				if (node === null || text === drawn) return;
				drawn = text;
				paint(node, text);
				// Keeping the caret is part of the reset: a cleared box you are
				// still standing in is where the next comment gets typed.
				if (typeof document !== "undefined" && document.activeElement === node) {
					focusBody(node);
				}
			},
			{ immediate: false },
		),

		Div(
			{
				this: host,
				contentEditable: "true",
				role: "textbox",
				"aria-multiline": true,
				"aria-label": options.placeholder,
				// The browser's own spelling underline is worth keeping; its
				// formatting shortcuts are not, since ⌘B here writes markdown.
				spellcheck: true,
				class: cn(
					bodyComposerClass,
					{
						// Everything the rest of the panel does not need, when the caller
						// owns the height and has said so.
						"min-h-0 flex-1 overflow-y-auto": filling,
						// Capped rather than endless when the caller has neither given
						// height nor taken it: a dialog that grows with the body pushes
						// its own buttons off the screen.
						"max-h-48 overflow-y-auto": capped,
					},
					options.class,
				),
				style: {
					minHeight: options.rows === undefined ? "auto" : `${options.rows * 1.6}em`,
				},

				onInput: (event) => {
					if (composing) return;
					const node = host.get();
					// A delete that took the last of the text with it leaves the block
					// that held it behind — an empty heading, an empty quote — and the
					// marker for a block nobody can see is not part of the body.
					if (node !== null && event.inputType.startsWith("delete") && isBlank(node)) {
						apply({ value: "", start: 0, end: 0 });
						return;
					}
					const next = read();
					// Nothing the markdown can tell apart from what is already
					// drawn — a browser tidying its own DOM, most often.
					if (next === null || next.value === drawn) return;
					apply(next, { typed: true });
				},

				onCompositionstart: () => {
					composing = true;
				},
				onCompositionend: () => {
					composing = false;
					const next = read();
					if (next !== null) apply(next, { typed: true });
				},

				onKeydown: (event) => {
					// The mention menu claims the arrows, Enter, Tab and Escape while
					// it is open, so it gets the event first.
					if (mentions.onKeydown(event)) return;

					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						submit();
						return;
					}
					if (event.key === "Escape") {
						options.onEscape?.();
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						const current = read();
						if (current !== null && current.start >= 0) apply(breakLine(current, event.shiftKey));
						return;
					}
					if (event.key === "Backspace") {
						const current = read();
						// A mention first: it is the more specific reading, and the two
						// cannot both answer the same caret anyway.
						const undone = current === null ? null : (unmention(current) ?? unmark(current));
						if (undone === null) return;
						event.preventDefault();
						apply(undone);
						return;
					}
					if (event.key === "Tab") {
						const current = read();
						const nested = current === null ? null : indent(current, event.shiftKey);
						// Only a list answers Tab; everywhere else it still leaves the
						// box, which is the only way out of a body with the keyboard.
						if (nested === null) return;
						event.preventDefault();
						apply(nested);
						return;
					}

					if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

					const key = event.key.toLowerCase();
					if (key === "z") {
						// Ours rather than the browser's: every edit here redraws the
						// document, which is not a thing the native stack can replay.
						event.preventDefault();
						const step = event.shiftKey ? history.redo() : history.undo();
						if (step !== null) apply(step, { record: false });
						return;
					}
					if (key === "y") {
						event.preventDefault();
						const step = history.redo();
						if (step !== null) apply(step, { record: false });
						return;
					}

					const shortcut = SHORTCUTS[key];
					if (shortcut !== undefined && !event.shiftKey) {
						event.preventDefault();
						command(shortcut);
					}
				},

				onPaste: (event) => {
					// Pasted files are the attachment grid's business, and it is
					// listening further up.
					if (filesFromClipboard(event).length > 0) return;
					const text = event.clipboardData?.getData("text/plain") ?? "";
					if (text === "") return;
					event.preventDefault();
					const current = read();
					if (current === null || current.start < 0) return;
					apply({
						value: current.value.slice(0, current.start) + text + current.value.slice(current.end),
						start: current.start + text.length,
						end: current.start + text.length,
					});
				},

				onBlur: () => {
					// Picking from the menu blurs the box, and a caller that commits
					// on blur would close the editor out from under the insertion.
					if (mentions.open.get()) return;
					// The blank line a list or a quote was stepped out of is a line with
					// nothing on it, and nobody meant to post one. Taken off on the way
					// out rather than as it is typed, where it is the line the caret is
					// standing on.
					const tidy = options.value.get().replace(/\s+$/, "");
					if (tidy !== options.value.get()) {
						drawn = tidy;
						options.value.set(tidy);
					}
					options.onBlur?.();
				},

				onMousedown: (event) => {
					const node = host.get();
					if (node === null || node.contains(document.activeElement)) return;
					// A body you have not clicked into yet is one you are reading, and a
					// link in it is there to be followed the way it is anywhere else on
					// the page — a browser will not follow one inside an editable box on
					// its own. Once the caret is in here the same click places it
					// instead, so the link's own words can be edited like any others.
					const anchor = (event.target as HTMLElement).closest("a");
					// A mention is not editable text, so the browser already follows it.
					if (
						anchor === null ||
						anchor.hasAttribute("data-mention-path") ||
						anchor.hasAttribute("data-mention-user")
					) {
						return;
					}
					const href = anchor.getAttribute("href");
					if (href === null) return;
					event.preventDefault();
					window.open(href, "_blank", "noreferrer");
				},
			},

			// The body as the server can send it, so a description is on the page
			// before the script that would draw it has run. `paint` builds the same
			// nodes on mount and takes over from there.
			...renderMarkdown(options.value.get()),
		),

		If(
			empty,
			P(
				{
					// Sits on the first line rather than in the box: the box holds a
					// paragraph even when the body is empty, and two things cannot
					// share that line without one of them moving. Same size as the box,
					// or the words it stands in for would land somewhere else.
					class: cn(
						BODY_TEXT_CLASS,
						"pointer-events-none absolute top-0 left-0 leading-relaxed text-muted-foreground",
					),
					"aria-hidden": true,
				},
				options.placeholder ?? "",
			),
		),

		MentionMenu(mentions),
	);
}

/** ⌘/Ctrl plus this key runs this command. */
const SHORTCUTS: Record<string, (state: SelectionState) => SelectionState> = {
	b: (state) => toggleWrap(state, "**"),
	i: (state) => toggleWrap(state, "*"),
	e: (state) => toggleWrap(state, "`", "code"),
	k: insertLink,
};

/* -------------------------------------------------------------------------- */
/* The keys that mean something to markdown                                    */
/* -------------------------------------------------------------------------- */

interface Line {
	start: number;
	end: number;
	text: string;
}

function lineAt(value: string, index: number): Line {
	const start = index === 0 ? 0 : value.lastIndexOf("\n", index - 1) + 1;
	const found = value.indexOf("\n", index);
	const end = found === -1 ? value.length : found;
	return { start, end, text: value.slice(start, end) };
}

const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const QUOTE = /^( {0,3}> ?)(.*)$/;
const MARKER = /^[ \t]*(?:#{1,6} |> ?|[-*+] |\d{1,9}[.)] )/;
const FENCE = /^ {0,3}(?:```|~~~)/;

/** Whether the caret is inside a fenced block, where a newline is just a newline. */
function fenced(value: string, index: number): boolean {
	let open = false;
	for (const line of value.slice(0, index).split("\n")) {
		if (FENCE.test(line)) open = !open;
	}
	return open;
}

/**
 * Enter, which continues whatever the caret is standing in.
 *
 * A list makes another item, a quote another quoted line, a fenced block a
 * plain newline, and anything else a new paragraph. Enter on an item with
 * nothing in it leaves the list instead of making a second empty one — the
 * second press is how everyone ends a list.
 */
function breakLine(state: SelectionState, soft: boolean): SelectionState {
	const { value, start, end } = state;
	const before = value.slice(0, start);
	const after = value.slice(end);
	const line = lineAt(value, start);

	const insert = (text: string): SelectionState => ({
		value: before + text + after,
		start: start + text.length,
		end: start + text.length,
	});

	if (fenced(value, start)) {
		// Enter inside a block is a newline, except on a line with nothing on
		// it — a code block has no other way out, since every key that would
		// leave it is a key you might want to type into it.
		return line.text === "" ? leaveFence(state, line) : insert("\n");
	}
	if (soft) return insert("\n");

	const item = ITEM.exec(line.text);
	if (item !== null) {
		const indent = item[1]!;
		const marker = item[2]!;
		const gap = item[3]!;
		if (item[4] === "") {
			// Nothing in the item: drop the marker and step out of the list.
			return {
				value: `${value.slice(0, line.start)}\n${value.slice(line.end)}`,
				start: line.start + 1,
				end: line.start + 1,
			};
		}
		const next = /^\d/.test(marker)
			? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}`
			: marker;
		return insert(`\n${indent}${next}${gap}`);
	}

	const quote = QUOTE.exec(line.text);
	if (quote !== null) {
		if (quote[2] === "") {
			return {
				value: `${value.slice(0, line.start)}\n${value.slice(line.end)}`,
				start: line.start + 1,
				end: line.start + 1,
			};
		}
		return insert("\n> ");
	}

	// A blank line is what separates two paragraphs; one newline inside a
	// paragraph is a line break, which is what Shift+Enter is for.
	return insert("\n\n");
}

/**
 * Steps out of a fenced block, past its closing fence.
 *
 * The empty line the caret is on goes with it — it was the request to leave,
 * not a line of the program. The serializer always writes a closing fence, so
 * there is one to step over unless the block is the last thing in the body and
 * has not been read back yet.
 */
function leaveFence(state: SelectionState, line: Line): SelectionState {
	const { value } = state;
	const closing = lineAt(value, Math.min(line.end + 1, value.length));
	const closed = closing.start > line.start && FENCE.test(closing.text);

	const before = value.slice(0, line.start);
	const rail = closed ? closing.text : "```";
	const after = closed ? value.slice(closing.end) : value.slice(line.end);
	const caret = before.length + rail.length + 2;
	return { value: `${before}${rail}\n\n${after}`, start: caret, end: caret };
}

/**
 * The whole of a `@` reference, where one ends exactly at the caret.
 *
 * Both kinds are the same construct — `[@src/lib/foo.ts](url)` and
 * `[@Ada Lovelace](/app/…)` — and the `@` on the label is what separates either
 * from an ordinary link somebody wrote out by hand.
 */
const MENTION_END = /\[@[^\]\n]+\]\([^()\s]*\)$/;

/**
 * Backspace with the caret just after a mention, which takes the reference off
 * whole rather than a character out of the middle of a URL.
 *
 * A pill is one thing and is not editable text, so there is no last character
 * for Backspace to take. Left to the browser it spends the first press on the
 * zero-width character the caret was standing on — which serializes to nothing,
 * so the body does not change and the screen does not either — and only removes
 * the pill on the press after that. A mention that needs two presses before
 * anything happens is a mention that cannot be deleted, as far as the person
 * pressing is concerned.
 *
 * Inside a fenced block the same characters are a code sample rather than a
 * reference, and there Backspace is a character like it is anywhere else.
 */
function unmention(state: SelectionState): SelectionState | null {
	const { value, start, end } = state;
	if (start < 0 || start !== end) return null;
	if (fenced(value, start)) return null;

	const mention = MENTION_END.exec(value.slice(0, start));
	if (mention === null) return null;

	const at = start - mention[0].length;
	return { value: value.slice(0, at) + value.slice(start), start: at, end: at };
}

/**
 * Backspace at the head of a block's content, which takes the block's markup
 * off rather than a character out.
 *
 * The caret sits after the marker because the marker is not on screen — a
 * heading is drawn as a heading — so this is the only reading of Backspace
 * there that does anything visible. Everywhere else it returns null and the
 * browser deletes a character, which the round trip picks up as usual.
 */
function unmark(state: SelectionState): SelectionState | null {
	const { value, start, end } = state;
	if (start < 0 || start !== end) return null;

	const line = lineAt(value, start);
	if (fenced(value, start)) return null;

	const marker = MARKER.exec(line.text);
	if (marker === null || start !== line.start + marker[0].length) return null;

	return {
		value: value.slice(0, line.start) + line.text.slice(marker[0].length) + value.slice(line.end),
		start: line.start,
		end: line.start,
	};
}

/** Tab inside a list, which is the only place it means anything but "leave". */
function indent(state: SelectionState, out: boolean): SelectionState | null {
	const { value, start, end } = state;
	if (start < 0) return null;

	const line = lineAt(value, start);
	const item = ITEM.exec(line.text);
	if (item === null) return null;

	const width = item[1]!.length;
	if (out && width === 0) return null;

	const moved = out ? Math.max(0, width - 2) : width + 2;
	const shift = moved - width;
	const next = " ".repeat(moved) + line.text.slice(width);
	return {
		value: value.slice(0, line.start) + next + value.slice(line.end),
		start: start + shift,
		end: end + shift,
	};
}

/* -------------------------------------------------------------------------- */
/* Undo                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The editor's own undo.
 *
 * The browser's stack replays DOM operations, and every edit here throws the
 * DOM away and draws a new one from the markdown, so there is nothing for it
 * to replay. A stack of bodies is the honest version: each entry is a body and
 * a caret, and a run of typing collapses into one so that ⌘Z takes back a
 * word rather than a letter.
 */
const COALESCE_MS = 600;
const DEPTH = 200;

function createHistory(initial: SourceSelection) {
	const past: SourceSelection[] = [initial];
	const future: SourceSelection[] = [];
	let last = 0;

	return {
		record(state: SourceSelection): void {
			future.length = 0;
			const previous = past.at(-1);
			const now = Date.now();
			const typed =
				previous !== undefined &&
				now - last < COALESCE_MS &&
				state.value.length === previous.value.length + 1 &&
				!state.value.endsWith("\n");

			last = now;
			if (typed) past[past.length - 1] = state;
			else past.push(state);
			if (past.length > DEPTH) past.shift();
		},

		undo(): SourceSelection | null {
			if (past.length < 2) return null;
			const current = past.pop();
			if (current !== undefined) future.push(current);
			last = 0;
			return past.at(-1) ?? null;
		},

		redo(): SourceSelection | null {
			const next = future.pop();
			if (next === undefined) return null;
			past.push(next);
			last = 0;
			return next;
		},
	};
}
