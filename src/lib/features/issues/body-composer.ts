/**
 * The box an issue body or comment is written in.
 *
 * One component, used by the create dialog, the issue page, and the comment
 * box, so the three cannot drift apart: the same classes, the same `@`
 * wiring, the same keys, the same toolbar.
 *
 * It is always a live textarea. The issue page used to show the body as a
 * paragraph and swap in a textarea on click, which reads as two fields — the
 * text moves as the boxes trade places, the click that opened the editor is
 * spent on the paragraph rather than on the text, and the freshly mounted
 * textarea only takes focus if the document has not already honoured an
 * `autofocus` somewhere (it usually has). Keeping the textarea mounted means
 * the click lands on the field itself: focus is the browser's, and the caret
 * goes where you pressed.
 *
 * The markdown is styled where it is written rather than behind a Preview tab.
 * A tab is two views of one field — write in one, check your work in the other
 * — and everything that makes the box a box (the caret, the selection, the
 * scroll position, the `@` menu) had to be carried across the switch and put
 * back. lib/features/issues/markdown-decorations.ts draws the styling onto the
 * text instead, as an overlay on the live textarea, so there is one view and
 * nothing to hand over.
 *
 * The optional toolbar is the rest of the WYSIWYG: buttons and shortcuts that
 * write the markdown into the source for you. Deliberately not a rich-text
 * editor — the body stays the text it stores, and both overlays keep lining up
 * because the on-screen text is still the raw characters.
 */
import {
	Div,
	If,
	ImplementEffect,
	ImplementLifecycle,
	ImplementWindow,
	Textarea,
	derived,
	signal,
	type Child,
	type Signal,
} from "@implementjs/core";
import {
	Bold,
	Code,
	Heading,
	Italic,
	Link,
	List,
	ListOrdered,
	SquareCode,
	Strikethrough,
	TextQuote,
} from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
import { cn } from "@/lib/utils";
import { MentionMenu, MentionText, fileMentions, hasMention } from "./file-mentions";
import { DecoratedText } from "./markdown-decorations";
import {
	cycleHeading,
	insertLink,
	toggleBulletList,
	toggleCodeBlock,
	toggleNumberedList,
	toggleQuote,
	toggleWrap,
	type SelectionState,
} from "./markdown-commands";

/**
 * What the box and the layers drawn over it have to agree on: the size, the
 * line height, and where a line breaks. A hair's difference in any of them and
 * the two wrap in different places, which is the one way an overlay gives
 * itself away.
 */
const TEXT_LAYOUT = "text-[13px] leading-normal break-words whitespace-pre-wrap";

/**
 * How a body box looks, in one place.
 *
 * No border and no ring: the box is the text. Anything that paints an edge
 * around it while you type is the thing that made the issue page feel like a
 * different control from the composer.
 */
export const bodyComposerClass = cn(
	"w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground",
	// Transparent, not hidden: the box still holds the text, the selection and
	// the caret — the overlay only paints it. `caret-foreground` is the half of
	// that the colour would otherwise take with it, since a caret with no colour
	// of its own is the colour of the text.
	"text-transparent caret-foreground",
	TEXT_LAYOUT,
);

export interface BodyComposerOptions {
	/** The body being written. Two-way: typing writes straight back into it. */
	value: Signal<string>;
	slug: () => string;
	/** Which repository `@` searches, when the issue has one. */
	repository: () => string | undefined;
	placeholder?: string;
	/** The box's minimum height, in lines. */
	rows?: number;
	/** Grow with the text instead of scrolling inside a fixed box. */
	autoGrow?: boolean;
	/**
	 * Draw `@file` references as links while the box is not focused. The text
	 * underneath is still the textarea's, so the click is never intercepted.
	 */
	renderMentions?: boolean;
	/** The formatting toolbar and its shortcuts. */
	toolbar?: boolean;
	autofocus?: boolean;
	class?: string;
	/** Handed out so a caller can tell whether the caret is in this box. */
	element?: Signal<HTMLTextAreaElement | null>;
	/** ⌘⏎. */
	onSubmit?: () => void;
	/** Not called while the mention menu is open — picking a file blurs. */
	onBlur?: () => void;
	onEscape?: () => void;
}

export function BodyComposer(options: BodyComposerOptions) {
	const element = options.element ?? signal<HTMLTextAreaElement | null>(null);
	const overlay = signal<HTMLDivElement | null>(null);
	const focused = signal(false);

	const mentions = fileMentions({
		value: options.value,
		slug: options.slug,
		repository: options.repository,
		element,
	});

	const grow = () => {
		const node = element.get();
		if (node === null || options.autoGrow !== true) return;
		// `auto` first so the box can shrink again; `scrollHeight` is never less
		// than the height `rows` gives it, so the minimum needs no arithmetic.
		node.style.height = "auto";
		node.style.height = `${node.scrollHeight}px`;
	};

	/**
	 * Puts the decoration layer back over the text it decorates.
	 *
	 * Two things move it: a scrollbar, which takes width from the box's text but
	 * not from an `inset-0` layer's, so the two would wrap a character apart
	 * from each other; and scrolling, which the layer does not do on its own.
	 */
	const align = () => {
		const node = element.get();
		const layer = overlay.get();
		if (node === null || layer === null) return;
		layer.style.width = `${node.clientWidth}px`;
		layer.scrollTop = node.scrollTop;
	};

	/** Everything the text having changed asks of the box. */
	const sync = () => {
		grow();
		align();
	};

	const overlaid = derived(
		[options.value, focused],
		(text, active) => options.renderMentions === true && !active && hasMention(text),
	);

	/**
	 * Runs one command against the live selection and puts the caret where the
	 * command said. The value goes through the signal — the same road typing
	 * takes — so the overlay, the growing, and the caller all see it.
	 */
	const apply = (command: (state: SelectionState) => SelectionState) => {
		const node = element.get();
		if (node === null) return;
		const next = command({
			value: options.value.get(),
			start: node.selectionStart ?? 0,
			end: node.selectionEnd ?? 0,
		});
		options.value.set(next.value);
		queueMicrotask(() => {
			node.focus();
			node.setSelectionRange(next.start, next.end);
		});
	};

	return Div(
		{ class: "flex flex-col" },

		// Static, not `If`: whether a composer has a toolbar never changes
		// while it is mounted.
		options.toolbar === true ? ComposerToolbar({ apply }) : null,

		Div(
			{ class: "relative" },
			ImplementLifecycle({ onMount: () => sync() }),
			// Text arriving from anywhere but the keyboard — a draft restored, an
			// edit made elsewhere — has to resize the box too.
			ImplementEffect([options.value], () => sync(), { immediate: false }),
			// A narrower window rewraps the box; the layer has to rewrap with it.
			ImplementWindow({ onResize: () => align() }),

			// The markdown, drawn onto the text as it is typed. It steps aside for
			// the mention overlay below, which draws the same text its own way.
			Div(
				{
					this: overlay,
					class: cn("pointer-events-none absolute inset-0 overflow-hidden", TEXT_LAYOUT, {
						hidden: overlaid,
					}),
					"aria-hidden": true,
				},
				DecoratedText(options.value),
			),

			If(
				overlaid,
				Div(
					{
						// Clicks fall through to the textarea, so the box is still one
						// target — except on a link itself, which is the one thing here
						// you would rather follow than put a caret in.
						class: cn(
							"pointer-events-none absolute inset-0 [&_a]:pointer-events-auto",
							TEXT_LAYOUT,
						),
						"aria-hidden": true,
					},
					MentionText(options.value),
				),
			),

			Textarea({
				this: element,
				value: options.value,
				placeholder: options.placeholder,
				rows: options.rows,
				autofocus: options.autofocus,
				class: cn(bodyComposerClass, options.class),
				onInput: (event) => {
					mentions.onInput(event);
					sync();
				},
				// The layer does not scroll itself: it is drawn over a box that does.
				onScroll: () => align(),
				onFocus: () => focused.set(true),
				onBlur: () => {
					focused.set(false);
					// Picking from the menu blurs the box, and a caller that commits on
					// blur would close the editor out from under the insertion.
					if (mentions.open.get()) return;
					options.onBlur?.();
				},
				onKeydown: (event) => {
					// The mention menu claims the arrows, Enter and Escape while it is
					// open, so it gets the event first.
					mentions.onKeydown(event);
					if (event.defaultPrevented) return;
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						options.onSubmit?.();
						return;
					}
					if (event.key === "Escape") {
						options.onEscape?.();
						return;
					}
					if (options.toolbar === true && (event.metaKey || event.ctrlKey) && !event.altKey) {
						// The editor shortcuts every markdown box teaches: ⌘B, ⌘I, ⌘E,
						// ⌘K. Only with the toolbar, so a bare composer keeps the
						// browser's own bindings.
						const command = SHORTCUTS[event.key.toLowerCase()];
						if (command !== undefined && !event.shiftKey) {
							event.preventDefault();
							apply(command);
						}
					}
				},
			}),

			MentionMenu(mentions),
		),
	);
}

/** ⌘/Ctrl plus this key runs this command. */
const SHORTCUTS: Record<string, (state: SelectionState) => SelectionState> = {
	b: (state) => toggleWrap(state, "**"),
	i: (state) => toggleWrap(state, "*"),
	e: (state) => toggleWrap(state, "`", "code"),
	k: insertLink,
};

/**
 * The formatting row above the box.
 *
 * Every control acts on `mousedown` and prevents the default, so the textarea
 * never loses focus: the selection a button formats is the one that was
 * visible when it was pressed.
 */
function ComposerToolbar({
	apply,
}: {
	apply: (command: (state: SelectionState) => SelectionState) => void;
}) {
	const tool = (
		icon: (props: { class?: string }) => Child,
		label: string,
		command: (state: SelectionState) => SelectionState,
	) =>
		Button(
			{
				variant: "ghost",
				size: "icon-xs",
				type: "button",
				title: label,
				"aria-label": label,
				// Reachable through the shortcuts and the box itself; tabbing
				// through ten buttons on the way out of a comment is not a path.
				tabIndex: -1,
				class: "text-muted-foreground hover:text-foreground",
				onMousedown: (event) => {
					event.preventDefault();
					apply(command);
				},
			},
			icon({ class: "size-3.5" }),
		);

	return Div(
		{ class: "mb-2 flex flex-wrap items-center gap-0.5 border-b border-border pb-1.5" },
		tool(Bold, "Bold (⌘B)", (state) => toggleWrap(state, "**")),
		tool(Italic, "Italic (⌘I)", (state) => toggleWrap(state, "*")),
		tool(Strikethrough, "Strikethrough", (state) => toggleWrap(state, "~~")),
		tool(Code, "Inline code (⌘E)", (state) => toggleWrap(state, "`", "code")),
		tool(SquareCode, "Code block", toggleCodeBlock),
		tool(Heading, "Heading", cycleHeading),
		tool(List, "Bulleted list", toggleBulletList),
		tool(ListOrdered, "Numbered list", toggleNumberedList),
		tool(TextQuote, "Quote", toggleQuote),
		tool(Link, "Link (⌘K)", insertLink),
	);
}
