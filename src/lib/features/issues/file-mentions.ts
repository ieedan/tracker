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
	A,
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

/** Markdown, so the reference survives as a link wherever the body is rendered. */
export function mentionMarkdown(match: FileMatch): string {
	return `[@${match.path}](${match.url})`;
}

/**
 * Renders a body's `@file` references as links, leaving everything else alone.
 *
 * Not a markdown renderer — this recognises exactly the shape `mentionMarkdown`
 * writes and nothing else. A general renderer here would be a much bigger
 * promise than "the file you referenced is clickable", and would have to answer
 * for every other markdown construct in a field nothing else treats as
 * markdown.
 *
 * Nodes are built rather than HTML injected, so a body containing angle
 * brackets stays text. The URL is still checked: anyone can type this shape by
 * hand, and `javascript:` in an href is the obvious thing to try.
 */
const MENTION = /\[@([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

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

		parts.push(
			A(
				{
					href: match[2]!,
					target: "_blank",
					rel: "noreferrer",
					class:
						"inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-1 font-mono text-[0.9em] hover:border-ring",
					title: match[2],
				},
				`@${match[1]!.slice(match[1]!.lastIndexOf("/") + 1)}`,
			),
		);
		cursor = start + match[0].length;
	}

	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}

export interface MentionState {
	open: Readable<boolean>;
	matches: Readable<FileMatch[]>;
	highlighted: Signal<number>;
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
			return;
		}
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
			if (event.key === "Enter" || event.key === "Tab") {
				const picked = matches.get()[highlighted.get()];
				if (picked !== undefined) {
					// Stops the Enter from also submitting the composer.
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
			}
		},
		choose,
	};
}

/** The dropdown itself. Positioned by whatever wraps it. */
export function MentionMenu(state: MentionState, options: { class?: string } = {}) {
	return If(
		state.open,
		Div(
			{
				class: cn(
					"absolute z-50 mt-1 max-h-64 w-[26rem] max-w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md",
					options.class,
				),
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
							{ class: "max-w-[12rem] shrink-0 truncate text-[11px] text-muted-foreground" },
							match.bind((value) => value.path),
						),
					);
				},
			),
		),
	);
}
