/**
 * `@` file references in a textarea.
 *
 * Attaches to an existing textarea rather than replacing it with an editor:
 * the description and comment boxes are plain text everywhere else, and a rich
 * editor here would be a second way to write the same field.
 *
 * The rule for when the menu is open is the one people already know from every
 * other `@`: an `@` that starts a word, followed by no whitespace, with the
 * caret still inside that run.
 */
import {
	Div,
	Dynamic,
	ForEach,
	If,
	Span,
	derived,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { FileCode2 } from "@implementjs/lucide";
import { api } from "@/lib/client/api";
import { MentionLink } from "@/lib/components/markdown";
import { cn } from "@/lib/utils";

export interface FileMatch {
	repositoryId: string;
	fullName: string;
	path: string;
	url: string;
}

/** The `@run` the caret currently sits in, or null. */
export function activeMention(
	value: string,
	caret: number,
): { query: string; start: number } | null {
	const upto = value.slice(0, caret);
	const at = upto.lastIndexOf("@");
	if (at === -1) return null;

	// `a@b` is an email, not a mention: the `@` has to start a word.
	const before = at === 0 ? "" : upto[at - 1]!;
	if (before !== "" && !/\s|[([{]/.test(before)) return null;

	const query = upto.slice(at + 1);
	// A space ends the run. So does a newline.
	if (/\s/.test(query)) return null;
	// Paths get long, but not this long — past here it is not a mention any more.
	if (query.length > 120) return null;

	return { query, start: at };
}

/**
 * Where a character sits, in pixels, inside a textarea.
 *
 * A textarea has no API for this — you cannot ask it where character 42 is —
 * so the standard trick is to build an invisible div with the exact same text
 * layout, put a marker at that offset, and read the marker's position. The
 * copied properties are the ones that affect where a glyph lands; getting one
 * wrong shifts the answer, which is why this takes them from the live element
 * rather than assuming the classes it was given.
 */
const MIRRORED = [
	"boxSizing",
	"width",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"fontFamily",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"letterSpacing",
	"lineHeight",
	"textTransform",
	"textIndent",
	"whiteSpace",
	"wordSpacing",
	"wordBreak",
	"overflowWrap",
] as const;

export interface CaretPoint {
	/** Relative to the textarea's box, which is what an absolute child needs. */
	left: number;
	top: number;
	/** One line's height, so a menu can sit below the line rather than on it. */
	lineHeight: number;
	/** The same point in viewport terms, for deciding which way a menu opens. */
	viewportTop: number;
}

export function caretPoint(element: HTMLTextAreaElement, offset: number): CaretPoint {
	const computed = window.getComputedStyle(element);

	const mirror = document.createElement("div");
	for (const property of MIRRORED) {
		mirror.style[property] = computed[property];
	}
	// Off-screen but laid out, so it wraps exactly as the real one does.
	mirror.style.position = "absolute";
	mirror.style.top = "0";
	mirror.style.left = "-9999px";
	mirror.style.visibility = "hidden";
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.overflowWrap = "break-word";

	mirror.textContent = element.value.slice(0, offset);

	// A zero-width marker: it has a position but does not push anything along.
	const marker = document.createElement("span");
	marker.textContent = "\u200b";
	mirror.append(marker);

	document.body.append(mirror);
	const left = marker.offsetLeft;
	const top = marker.offsetTop;
	mirror.remove();

	const lineHeight =
		Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.2 || 16;

	// The textarea may be scrolled; the caret's screen position is not its
	// position in the text.
	const relativeTop = top - element.scrollTop;
	return {
		left,
		top: relativeTop,
		lineHeight,
		viewportTop: element.getBoundingClientRect().top + relativeTop,
	};
}

/** Markdown, so the reference survives as a link wherever the body is rendered. */
export function mentionMarkdown(match: FileMatch): string {
	return `[@${match.path}](${match.url})`;
}

/**
 * Renders a body's `@file` references as links, leaving everything else alone.
 *
 * Deliberately not the markdown renderer, even though one exists now: this
 * draws the overlay that sits *on top of* a live textarea, so its output has to
 * occupy exactly the same space as the raw characters underneath it. A
 * markdown render collapses `**bold**` to four fewer characters and the caret
 * stops landing where you clicked. Posted bodies — where there is no textarea
 * to line up with — go through `Markdown` instead.
 *
 * The pill itself is shared with that renderer, so a mention looks the same
 * while it is being written as it does once it is posted.
 */
const MENTION = /\[@([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Whether a body has anything for {@link MentionText} to render differently. */
export function hasMention(body: string): boolean {
	// A global regex carries `lastIndex` between calls, so the pattern is
	// re-created rather than shared.
	return new RegExp(MENTION.source).test(body);
}

export function MentionText(body: Readable<string>, className?: string) {
	return Span(
		{ class: className },
		Dynamic([body], (text) => Span({ class: "contents" }, ...renderMentions(text))),
	);
}

function renderMentions(text: string): Child[] {
	const parts: Child[] = [];
	let cursor = 0;

	// `matchAll` needs the global flag, and a global regex carries `lastIndex`
	// between calls — so the pattern is re-created rather than shared.
	for (const match of text.matchAll(new RegExp(MENTION.source, "g"))) {
		const start = match.index;
		if (start > cursor) parts.push(text.slice(cursor, start));

		parts.push(MentionLink(match[1]!, match[2]!));
		cursor = start + match[0].length;
	}

	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}

export interface MentionState {
	open: Readable<boolean>;
	matches: Readable<FileMatch[]>;
	highlighted: Signal<number>;
	/** Where the `@` is, so the menu can sit under it rather than under the box. */
	anchor: Readable<CaretPoint | null>;
	/** Wire these into the textarea. */
	onInput: (event: { target: HTMLTextAreaElement }) => void;
	onKeydown: (event: KeyboardEvent & { target: HTMLTextAreaElement }) => void;
	choose: (match: FileMatch) => void;
}

/**
 * Wires up `@` handling for one textarea.
 *
 * `slug` and `repository` are read at call time rather than captured, so the
 * same wiring keeps working when the issue is rescoped while the box is open.
 */
export function fileMentions(options: {
	value: Signal<string>;
	slug: () => string;
	/** Narrow results to the issue's repository, when it has one. */
	repository: () => string | undefined;
	/** So the caret can be restored after an insertion. */
	element: Signal<HTMLTextAreaElement | null>;
}): MentionState {
	const matches = signal<FileMatch[]>([]);
	const query = signal<{ query: string; start: number } | null>(null);
	const highlighted = signal(0);
	const anchor = signal<CaretPoint | null>(null);
	const open = derived([query, matches], (current, list) => current !== null && list.length > 0);

	let sequence = 0;

	const search = async (term: string) => {
		const mine = ++sequence;
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/files", {
			params: { slug: options.slug() },
			query: { q: term, repository: options.repository(), limit: 8 },
		});
		// A slower earlier request must not overwrite a faster later one.
		if (mine !== sequence) return;
		matches.set(error === undefined ? data : []);
		highlighted.set(0);
	};

	const refresh = (element: HTMLTextAreaElement) => {
		const found = activeMention(element.value, element.selectionStart ?? 0);
		query.set(found);
		if (found === null) {
			matches.set([]);
			anchor.set(null);
			return;
		}
		// Anchored to the `@` rather than to the caret: the menu should stay put
		// while the query is typed, not creep right with every character.
		anchor.set(caretPoint(element, found.start));
		void search(found.query);
	};

	const choose = (match: FileMatch) => {
		const element = options.element.get();
		const current = query.get();
		if (element === null || current === null) return;

		const caret = element.selectionStart ?? 0;
		const inserted = `${mentionMarkdown(match)} `;
		const next =
			options.value.get().slice(0, current.start) + inserted + options.value.get().slice(caret);

		options.value.set(next);
		query.set(null);
		matches.set([]);
		anchor.set(null);

		// Put the caret after what was inserted, so typing carries on naturally.
		const position = current.start + inserted.length;
		queueMicrotask(() => {
			element.focus();
			element.setSelectionRange(position, position);
		});
	};

	return {
		open,
		matches,
		highlighted,
		anchor,
		onInput: (event) => refresh(event.target),
		onKeydown: (event) => {
			if (!open.get()) return;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				highlighted.update((index) => (index + 1) % matches.get().length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				highlighted.update((index) => (index - 1 + matches.get().length) % matches.get().length);
				return;
			}
			// Tab completes the highlighted file rather than leaving the box. A
			// menu that is showing a choice is what Tab is for; the composer only
			// hands Tab on to the next control when there is no menu to answer it.
			if (event.key === "Enter" || event.key === "Tab") {
				const picked = matches.get()[highlighted.get()];
				if (picked !== undefined) {
					// Stops the Enter from also submitting the composer, and the Tab
					// from also moving focus out of it.
					event.preventDefault();
					event.stopPropagation();
					choose(picked);
				}
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				query.set(null);
				matches.set([]);
				anchor.set(null);
			}
		},
		choose,
	};
}

/**
 * The dropdown, positioned under the `@` that opened it.
 *
 * Absolutely placed inside the textarea's own relatively-positioned wrapper, so
 * the coordinates are the ones `caretPoint` measured.
 *
 * Which way it opens is decided from the match count rather than by measuring
 * the rendered menu. Measuring would mean placing it, letting it lay out, then
 * moving it — a frame of the menu in the wrong place, and a dependency on
 * exactly when the element is attached. A row is a known height, so the height
 * is known before anything renders.
 */
const ROW_HEIGHT = 30;
const MENU_PADDING = 8;
const MENU_MAX_HEIGHT = 256;
const MENU_GAP = 4;

function menuHeight(count: number): number {
	return Math.min(count * ROW_HEIGHT + MENU_PADDING, MENU_MAX_HEIGHT);
}

export function MentionMenu(state: MentionState, options: { class?: string } = {}) {
	/** True when there is no room below the line but there is room above it. */
	const flipped = derived([state.anchor, state.matches], (point, matches) => {
		if (point === null || typeof window === "undefined") return false;
		const height = menuHeight(matches.length);
		const below = window.innerHeight - (point.viewportTop + point.lineHeight);
		return below < height + MENU_GAP && point.viewportTop > height;
	});

	// `Styles` takes a bindable per property, so each is derived on its own
	// rather than the whole object being swapped.
	const position = {
		left: derived([state.anchor], (point) =>
			point === null ? "0" : `${Math.max(0, point.left)}px`,
		),
		top: derived([state.anchor, flipped], (point, isFlipped) =>
			point === null || isFlipped ? "auto" : `${point.top + point.lineHeight + MENU_GAP}px`,
		),
		// `bottom` is measured from the container's bottom edge, so putting the
		// menu's bottom `n` px from its *top* is `calc(100% - n)`. A bare
		// `-point.top` would hang it below the box instead of above the line.
		bottom: derived([state.anchor, flipped], (point, isFlipped) =>
			point !== null && isFlipped ? `calc(100% - ${point.top - MENU_GAP}px)` : "auto",
		),
	};

	return If(
		state.open,
		Div(
			{
				class: cn(
					"absolute z-50 max-h-64 w-[24rem] max-w-[min(24rem,100%)] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md",
					options.class,
				),
				style: position,
			},
			ForEach(
				state.matches,
				(match) => `${match.repositoryId}:${match.path}`,
				(match) => {
					const index = state.matches.get().findIndex((entry) => entry.path === match.get().path);
					return Div(
						{
							class: derived([state.highlighted], (current) =>
								cn(
									"flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px]",
									current === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
								),
							),
							// `mousedown` rather than `click`: the textarea would blur first
							// and close the menu before a click ever landed.
							onMousedown: (event) => {
								event.preventDefault();
								state.choose(match.get());
							},
						},
						FileCode2({ class: "size-3.5 shrink-0 text-muted-foreground" }),
						Span(
							{ class: "min-w-0 flex-1 truncate" },
							match.bind((value) => value.path.slice(value.path.lastIndexOf("/") + 1)),
						),
						Span(
							{ class: "max-w-[11rem] shrink-0 truncate text-[11px] text-muted-foreground" },
							match.bind((value) => value.path),
						),
					);
				},
			),
		),
	);
}
