/**
 * The box an issue body is written in.
 *
 * One component, used by the create dialog and the issue page, so the two
 * cannot drift apart: the same classes, the same `@` wiring, the same keys.
 *
 * It is always a live textarea. The issue page used to show the body as a
 * paragraph and swap in a textarea on click, which reads as two fields — the
 * text moves as the boxes trade places, the click that opened the editor is
 * spent on the paragraph rather than on the text, and the freshly mounted
 * textarea only takes focus if the document has not already honoured an
 * `autofocus` somewhere (it usually has). Keeping the textarea mounted means
 * the click lands on the field itself: focus is the browser's, and the caret
 * goes where you pressed.
 */
import {
	Div,
	If,
	ImplementEffect,
	ImplementLifecycle,
	Textarea,
	derived,
	signal,
	type Signal,
} from "@implementjs/core";
import { cn } from "@/lib/utils";
import { MentionMenu, MentionText, fileMentions, hasMention } from "./file-mentions";

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
	 * Draw `@file` references as links while the box is not focused. The text
	 * underneath is still the textarea's, so the click is never intercepted.
	 */
	renderMentions?: boolean;
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

	const overlaid = derived(
		[options.value, focused],
		(text, active) => options.renderMentions === true && !active && hasMention(text),
	);

	return Div(
		{ class: "relative" },
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
			class: cn(bodyComposerClass, { "text-transparent": overlaid }, options.class),
			onInput: (event) => {
				mentions.onInput(event);
				grow();
			},
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
				if (event.key === "Escape") options.onEscape?.();
			},
		}),

		MentionMenu(mentions),
	);
}
