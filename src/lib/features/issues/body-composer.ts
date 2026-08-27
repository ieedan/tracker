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
 * The optional toolbar is the WYSIWYG the composer offers: buttons and
 * shortcuts that write the markdown into the source for you, and a Preview
 * tab that renders it through the same renderer every posted body goes
 * through. Deliberately not a rich-text editor — the body stays the text it
 * stores, and the mention overlay keeps lining up because the on-screen text
 * is still the raw characters.
 */
import {
	Div,
	If,
	ImplementDocument,
	ImplementEffect,
	ImplementLifecycle,
	P,
	Span,
	Textarea,
	derived,
	signal,
	type Child,
	type Readable,
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
import { Markdown } from "@/lib/components/markdown";
import { Button } from "@/lib/components/ui/button";
import { cn } from "@/lib/utils";
import { MentionMenu, MentionText, fileMentions, hasMention } from "./file-mentions";
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
 * How a body box looks, in one place.
 *
 * No border and no ring: the box is the text. Anything that paints an edge
 * around it while you type is the thing that made the issue page feel like a
 * different control from the composer.
 */
export const bodyComposerClass =
	"w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-normal outline-none placeholder:text-muted-foreground";

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
	 * Take the height the parent has left instead of the one `rows` asks for,
	 * scrolling inside it. For a caller that owns the height — the expanded
	 * create dialog — where `rows` is only the collapsed minimum.
	 *
	 * Reactive so a toggle can flip it in place: remounting the box would throw
	 * away the browser's undo history along with the caret.
	 */
	fill?: boolean | Readable<boolean>;
	/**
	 * Draw `@file` references as links while the box is not focused. The text
	 * underneath is still the textarea's, so the click is never intercepted.
	 */
	renderMentions?: boolean;
	/** The formatting toolbar and the Write / Preview tabs. */
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
	const root = signal<HTMLDivElement | null>(null);
	const focused = signal(false);
	const previewing = signal(false);
	// Every box in the chain has to opt in for a percentage height to resolve:
	// the root, the one that is actually filled, and the textarea itself.
	const fill = options.fill ?? false;

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
		if (node === null || previewing.get()) return;
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

	// Where the caret was when Preview was opened, so Write puts it back.
	let held: [number, number] = [0, 0];

	const write = () => {
		if (!previewing.get()) return;
		previewing.set(false);
		queueMicrotask(() => {
			const node = element.get();
			if (node === null) return;
			node.focus();
			node.setSelectionRange(held[0], held[1]);
		});
	};

	const preview = () => {
		if (previewing.get()) return;
		const node = element.get();
		held = [node?.selectionStart ?? 0, node?.selectionEnd ?? 0];
		// Set before the textarea hides, so the blur that hiding fires is
		// recognisably ours and does not commit the caller's editor.
		previewing.set(true);
	};

	return Div(
		{ this: root, class: cn("flex flex-col", { "min-h-0 flex-1": fill }) },

		// Static, not `If`: whether a composer has a toolbar never changes
		// while it is mounted.
		options.toolbar === true ? ComposerToolbar({ previewing, apply, write, preview }) : null,

		// Preview replaces the box but never unmounts it: the browser's undo
		// history lives in the element, and this keeps it.
		Div(
			{ class: cn("relative", { hidden: previewing, "min-h-0 flex-1": fill }) },
			ImplementLifecycle({ onMount: () => grow() }),
			// Text arriving from anywhere but the keyboard — a draft restored, an
			// edit made elsewhere — has to resize the box too.
			ImplementEffect([options.value], () => grow(), { immediate: false }),

			If(
				overlaid,
				Div(
					{
						// Clicks fall through to the textarea, so the box is still one
						// target — except on a link itself, which is the one thing here
						// you would rather follow than put a caret in.
						class:
							"pointer-events-none absolute inset-0 text-[13px] leading-normal break-words whitespace-pre-wrap [&_a]:pointer-events-auto",
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
				// Hidden rather than unmounted while the links are drawn over it: the
				// textarea has to keep the click, and the caret has to land in the
				// text it is measuring against.
				class: cn(
					bodyComposerClass,
					{ "text-transparent": overlaid, "h-full": fill },
					options.class,
				),
				onInput: (event) => {
					mentions.onInput(event);
					grow();
				},
				onFocus: () => focused.set(true),
				onBlur: () => {
					focused.set(false);
					// Picking from the menu blurs the box, and a caller that commits on
					// blur would close the editor out from under the insertion. Opening
					// the preview hides the box, which blurs it the same way.
					if (mentions.open.get() || previewing.get()) return;
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

		If(
			previewing,
			Div(
				// Preview stands in for the box, so under `fill` it has to hold the
				// same height rather than let the panel collapse around it.
				{ class: cn({ "min-h-0 flex-1 overflow-y-auto": fill }) },
				// A click anywhere else is the same "I am done here" that blur is
				// for the box — without this, a preview left open would swallow the
				// commit a caller expects on the way out.
				ImplementDocument({
					onMousedown: (event) => {
						const container = root.get();
						if (container === null || container.contains(event.target as Node)) return;
						previewing.set(false);
						options.onBlur?.();
					},
				}),
				If(options.value.bind((text) => text.trim() !== ""))
					.Then(Markdown(options.value))
					.Else(P({ class: "text-[13px] text-muted-foreground" }, "Nothing to preview")),
			),
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
 * Write / Preview on the left, formatting on the right — the shape every
 * markdown box since GitHub's has taught.
 *
 * Every control acts on `mousedown` and prevents the default, so the textarea
 * never loses focus (or, for the tabs, loses it only to the preview): the
 * selection a button formats is the one that was visible when it was pressed.
 */
function ComposerToolbar({
	previewing,
	apply,
	write,
	preview,
}: {
	previewing: Signal<boolean>;
	apply: (command: (state: SelectionState) => SelectionState) => void;
	write: () => void;
	preview: () => void;
}) {
	const tab = (label: string, active: (value: boolean) => boolean, activate: () => void) =>
		Button(
			{
				variant: "ghost",
				size: "xs",
				type: "button",
				class: cn("h-6 px-2 text-[12px] font-normal text-muted-foreground", {
					"bg-secondary text-foreground": previewing.bind(active),
				}),
				onMousedown: (event) => {
					event.preventDefault();
					activate();
				},
			},
			label,
		);

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
				disabled: previewing,
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
		tab("Write", (value) => !value, write),
		tab("Preview", (value) => value, preview),
		Span({ class: "flex-1" }),
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
