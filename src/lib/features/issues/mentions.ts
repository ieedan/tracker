/**
 * `@` references in the body composer — the people in the workspace, and the
 * files in its repositories.
 *
 * The rule for when the menu is open is the one people already know from every
 * other `@`: an `@` that starts a word, followed by no whitespace, with the
 * caret still inside that run.
 *
 * The run is read out of the markdown the composer is editing rather than out
 * of the DOM — an unfinished mention is plain text either way, and the source
 * is where the insertion has to land. Only the menu's position comes from the
 * document, since where the `@` is on screen is a question only the screen can
 * answer.
 *
 * People sort above files, and are the first thing a bare `@` offers. `@` means
 * a person almost everywhere else it appears, so the menu that opens on it has
 * to be able to answer that reading first; a path is what you get once you have
 * typed enough of one to say you meant it.
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
import { UserAvatar } from "@/lib/components/glyphs";
import { fuzzyScore, rankPath } from "@/lib/domain/fuzzy";
import type { Member } from "@/lib/domain/schemas";
import { userMentionMarkdown } from "@/lib/domain/user-mentions";
import { cn } from "@/lib/utils";
import { cachedMembers, warmMembers } from "./member-cache";

export interface FileMatch {
	repositoryId: string;
	fullName: string;
	path: string;
	url: string;
}

/** One row of the menu: somebody in the workspace, or a file in one of its repos. */
export type MentionMatch =
	| { kind: "member"; member: Member; positions: number[] }
	| { kind: "file"; file: FileMatch };

/** Stable across a re-query, so a row that keeps its place keeps its identity. */
function matchKey(match: MentionMatch): string {
	return match.kind === "member"
		? `member:${match.member.user.id}`
		: `file:${match.file.repositoryId}:${match.file.path}`;
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
	// A space ends the run. So does a newline. Names have spaces in them and
	// this does not admit one, which is what the fuzzy ranking is for: `@ab`
	// finds "Aidan Bleser" without the run having to survive the gap.
	if (/\s/.test(query)) return null;
	// Paths get long, but not this long — past here it is not a mention any more.
	if (query.length > 120) return null;

	return { query, start: at };
}

/** Markdown, so the reference survives as a link wherever the body is rendered. */
export function mentionMarkdown(match: MentionMatch, slug: string): string {
	return match.kind === "member"
		? userMentionMarkdown(slug, match.member.user)
		: `[@${match.file.path}](${match.file.url})`;
}

export interface CaretPoint {
	/** Relative to the editor's box, which is what an absolute child needs. */
	left: number;
	top: number;
	/** One line's height, so a menu can sit below the line rather than on it. */
	lineHeight: number;
	/** The same point in viewport terms, for deciding which way a menu opens. */
	viewportTop: number;
}

/**
 * Where the `@` that opened the menu is drawn.
 *
 * Anchored to the `@` rather than to the caret so the menu stays put while the
 * query is typed instead of creeping right with every character. The run is
 * still plain text at this point, so it is one text node and the `@` is found
 * by looking back along it.
 */
export function mentionPoint(host: HTMLElement): CaretPoint | null {
	const selection = window.getSelection();
	if (selection === null || selection.rangeCount === 0) return null;

	const range = selection.getRangeAt(0);
	const node = range.startContainer;
	if (!host.contains(node) || node.nodeType !== Node.TEXT_NODE) return null;

	const at = (node as Text).data.lastIndexOf("@", Math.max(range.startOffset - 1, 0));
	if (at === -1) return null;

	const marker = document.createRange();
	marker.setStart(node, at);
	marker.setEnd(node, at + 1);
	const rect = marker.getBoundingClientRect();
	const box = host.getBoundingClientRect();

	return {
		left: rect.left - box.left,
		top: rect.top - box.top,
		lineHeight: rect.height,
		viewportTop: rect.top,
	};
}

export interface MentionState {
	open: Readable<boolean>;
	matches: Readable<MentionMatch[]>;
	/** What has been typed after the `@`, so the menu can show what it matched. */
	term: Readable<string>;
	highlighted: Signal<number>;
	/** Where the `@` is, so the menu can sit under it rather than under the box. */
	anchor: Readable<CaretPoint | null>;
	/** Call after every edit: the body as it now reads, and where the caret is. */
	refresh: (value: string, caret: number, host: HTMLElement | null) => void;
	/** True when the menu answered the key, so the composer should not. */
	onKeydown: (event: KeyboardEvent) => boolean;
	close: () => void;
	choose: (match: MentionMatch) => void;
}

/**
 * How many rows the menu holds. More than fits without scrolling, because a
 * fuzzy query that matches broadly should still let the tenth-best answer be
 * reached with the arrow keys rather than by typing more.
 */
const MENU_ROWS = 12;
/**
 * How much of that people may take.
 *
 * A bare `@` in a big workspace would otherwise be a list of names with the
 * files pushed off the bottom, and `@` has meant "a file here" for as long as
 * the box has existed. Past the cap, typing another character is what surfaces
 * the rest — which is what typing a name is for anyway.
 */
const MEMBER_ROWS = 5;
/** Long enough to coalesce a fast typist's keystrokes, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 60;

/**
 * The people a query names, best first.
 *
 * Ranked against the name and against the address's local part, because both
 * are things somebody reaches for: `@aidan` should find Aidan Bleser whether
 * that is how they are named or only how they are addressed. The name's score
 * wins ties, so the positions drawn in the row are the ones on screen.
 */
export function rankMembers(query: string, members: Member[], limit = MEMBER_ROWS): MentionMatch[] {
	const scored: { match: MentionMatch; score: number }[] = [];

	for (const member of members) {
		const byName = fuzzyScore(query, member.user.name);
		const local = member.user.email.split("@")[0] ?? "";
		const byEmail = local === "" ? null : fuzzyScore(query, local);
		if (byName === null && byEmail === null) continue;

		// An address match is a weaker signal than a name match, so it never
		// outranks one; within each, the fuzzy score decides.
		const score = byName !== null ? byName.score + 1000 : byEmail!.score;
		scored.push({
			match: { kind: "member", member, positions: byName?.positions ?? [] },
			score,
		});
	}

	return scored
		.toSorted((left, right) => right.score - left.score)
		.slice(0, limit)
		.map((entry) => entry.match);
}

/**
 * Wires up `@` handling for one composer.
 *
 * `slug` and `repository` are read at call time rather than captured, so the
 * same wiring keeps working when the issue is rescoped while the box is open.
 * `insert` belongs to the composer, since replacing the run is an edit to the
 * body like any other and has to go through the same round trip.
 */
export function bodyMentions(options: {
	slug: () => string;
	/** Narrow file results to the issue's repository, when it has one. */
	repository: () => string | undefined;
	/** Replace the `@run` at `start` with the mention's markdown. */
	insert: (start: number, markdown: string) => void;
}): MentionState {
	const matches = signal<MentionMatch[]>([]);
	const query = signal<{ query: string; start: number } | null>(null);
	const highlighted = signal(0);
	const anchor = signal<CaretPoint | null>(null);
	const open = derived([query, matches], (current, list) => current !== null && list.length > 0);
	const term = derived([query], (current) => current?.query ?? "");

	let sequence = 0;
	let pending: ReturnType<typeof setTimeout> | null = null;

	/**
	 * People are ranked from the cached list, which is why they can be drawn
	 * before the file request has been sent — a menu that waited for the network
	 * to show a name it already had would flicker on every keystroke.
	 */
	const showMembers = (typed: string): MentionMatch[] => {
		const people = rankMembers(typed, cachedMembers(options.slug()));
		matches.set([...people, ...matches.get().filter((match) => match.kind === "file")]);
		highlighted.set(0);
		return people;
	};

	const search = async (typed: string) => {
		const mine = ++sequence;
		const people = rankMembers(typed, cachedMembers(options.slug()));
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/files", {
			params: { slug: options.slug() },
			query: { q: typed, repository: options.repository(), limit: MENU_ROWS - people.length },
		});
		// A slower earlier request must not overwrite a faster later one.
		if (mine !== sequence) return;
		const files: MentionMatch[] =
			error === undefined ? data.map((file) => ({ kind: "file", file })) : [];
		matches.set([...people, ...files]);
		highlighted.set(0);
	};

	/**
	 * A loose query reaches a lot of the index, so a request per keystroke is
	 * work nobody reads: everything but the last one is replaced before it
	 * lands. Opening the menu is not debounced — `@` on its own should answer at
	 * once — and the in-flight guard above still covers responses arriving out
	 * of order.
	 */
	const scheduleSearch = (typed: string) => {
		if (pending !== null) clearTimeout(pending);
		if (typed === "") {
			pending = null;
			void search(typed);
			return;
		}
		pending = setTimeout(() => {
			pending = null;
			void search(typed);
		}, SEARCH_DEBOUNCE_MS);
	};

	const close = () => {
		if (pending !== null) clearTimeout(pending);
		pending = null;
		// Nothing in flight may land after this, or the menu would reopen itself.
		sequence++;
		query.set(null);
		matches.set([]);
		anchor.set(null);
	};

	const choose = (match: MentionMatch) => {
		const current = query.get();
		if (current === null) return;
		const slug = options.slug();
		close();
		options.insert(current.start, mentionMarkdown(match, slug));
	};

	return {
		open,
		matches,
		term,
		highlighted,
		anchor,
		refresh: (value, caret, host) => {
			const found = caret < 0 ? null : activeMention(value, caret);
			query.set(found);
			if (found === null) {
				close();
				return;
			}
			anchor.set(host === null ? null : mentionPoint(host));
			// Cheap and local, so the people half of the menu is on screen for the
			// keystroke that asked for it rather than a round trip later. The first
			// `@` in a tab is the one that pays for the list; it is warmed rather
			// than awaited, and the search below redraws once it lands.
			showMembers(found.query);
			void warmMembers(options.slug()).then((people) => {
				// Still the same run, still the same query — otherwise this is an
				// answer to a menu that has since closed or moved on.
				if (people.length === 0 || query.get() !== found) return;
				showMembers(found.query);
			});
			scheduleSearch(found.query);
		},
		onKeydown: (event) => {
			if (!open.get()) return false;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				highlighted.update((index) => (index + 1) % matches.get().length);
				return true;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				highlighted.update((index) => (index - 1 + matches.get().length) % matches.get().length);
				return true;
			}
			// Tab completes the highlighted row rather than leaving the box. A
			// menu that is showing a choice is what Tab is for; the composer only
			// hands Tab on to the next control when there is no menu to answer it.
			if (event.key === "Enter" || event.key === "Tab") {
				const picked = matches.get()[highlighted.get()];
				if (picked === undefined) return false;
				// Stops the Enter from also breaking the line, and the Tab from
				// also moving focus out of the box.
				event.preventDefault();
				event.stopPropagation();
				choose(picked);
				return true;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
				return true;
			}
			return false;
		},
		close,
		choose,
	};
}

/**
 * The dropdown, positioned under the `@` that opened it.
 *
 * Absolutely placed inside the editor's own relatively-positioned wrapper, so
 * the coordinates are the ones `mentionPoint` measured.
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

/**
 * `text` with the characters the query landed on picked out.
 *
 * A subsequence match is not obvious from the result alone — why
 * `src/lib/server/mcp/tools.ts` answers `libmcp` is a question the row should
 * not leave open — so the ranking is scored again here and the winning
 * characters are emphasised. `slice` is the offset of `text` within the path
 * the positions were measured against, since the basename is drawn on its own.
 */
function Emphasised(text: string, positions: number[], slice = 0): Child {
	const parts: Child[] = [];
	let cursor = 0;
	for (const position of positions) {
		const index = position - slice;
		if (index < cursor || index >= text.length) continue;
		if (index > cursor) parts.push(text.slice(cursor, index));
		parts.push(Span({ class: "font-semibold text-foreground" }, text[index]!));
		cursor = index + 1;
	}
	if (parts.length === 0) return text;
	if (cursor < text.length) parts.push(text.slice(cursor));
	return Span({ class: "contents" }, ...parts);
}

/** A person: their picture, their name, and the address that tells two apart. */
function MemberRow(member: Member, positions: number[]): Child[] {
	return [
		UserAvatar(member.user, "size-4"),
		Span({ class: "min-w-0 flex-1 truncate" }, Emphasised(member.user.name, positions)),
		Span(
			{ class: "max-w-[11rem] shrink-0 truncate text-[11px] text-muted-foreground" },
			member.user.email,
		),
	];
}

/** A file: its name, and the path that says which of the three it is. */
function FileRow(file: FileMatch, typed: string): Child[] {
	const positions = rankPath(typed, file.path)?.positions ?? [];
	const start = file.path.lastIndexOf("/") + 1;
	return [
		FileCode2({ class: "size-3.5 shrink-0 text-muted-foreground" }),
		Span(
			{ class: "min-w-0 flex-1 truncate" },
			Emphasised(file.path.slice(start), positions, start),
		),
		Span(
			{ class: "max-w-[11rem] shrink-0 truncate text-[11px] text-muted-foreground" },
			Emphasised(file.path, positions),
		),
	];
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
				matchKey,
				// `index` comes from the list rather than being looked up, so a row
				// that keeps its place across a re-query knows which place that is.
				(match, index) =>
					Div(
						{
							class: derived([state.highlighted, index], (current, position) =>
								cn(
									"flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px]",
									current === position ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
								),
							),
							// `mousedown` rather than `click`: the editor would blur first
							// and close the menu before a click ever landed.
							onMousedown: (event) => {
								event.preventDefault();
								state.choose(match.get());
							},
						},
						Dynamic([match, state.term], (value, typed) =>
							Span(
								{ class: "contents" },
								...(value.kind === "member"
									? MemberRow(value.member, value.positions)
									: FileRow(value.file, typed)),
							),
						),
					),
			),
		),
	);
}
