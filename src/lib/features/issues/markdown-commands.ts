/**
 * The toolbar's edits, as pure functions over the textarea's state.
 *
 * The composer stays a textarea — the WYSIWYG here is a toolbar that writes
 * the markdown for you and a preview tab that renders it, not a rich-text
 * model. That keeps the body the text it stores (the reason the issue page
 * renders and edits the same string), keeps the `@` mention overlay working
 * (it depends on the on-screen text being the raw characters), and means
 * these commands need nothing from the DOM: value in, value out, with the
 * selection that should follow.
 *
 * Every command toggles. Bold on bold text unbolds it, quote on a quote
 * unquotes it — a button that can only add is a button you press twice and
 * then reach for undo.
 */

export interface SelectionState {
	value: string;
	/** Selection in character offsets, `start === end` for a bare caret. */
	start: number;
	end: number;
}

/**
 * Wrap the selection in an inline marker — `**`, `*`, `~~`, `` ` `` — or
 * strip it when it is already there, just inside or just outside the
 * selection. An empty selection gets the placeholder, selected so the next
 * keystroke replaces it.
 */
export function toggleWrap(
	state: SelectionState,
	marker: string,
	placeholder = "text",
): SelectionState {
	const { value, start, end } = state;
	const selected = value.slice(start, end);
	const width = marker.length;

	if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
		const inner = selected.slice(width, selected.length - width);
		return {
			value: value.slice(0, start) + inner + value.slice(end),
			start,
			end: start + inner.length,
		};
	}

	if (
		start >= width &&
		value.slice(start - width, start) === marker &&
		value.startsWith(marker, end)
	) {
		return {
			value: value.slice(0, start - width) + selected + value.slice(end + width),
			start: start - width,
			end: end - width,
		};
	}

	const inner = selected === "" ? placeholder : selected;
	return {
		value: value.slice(0, start) + marker + inner + marker + value.slice(end),
		start: start + width,
		end: start + width + inner.length,
	};
}

/** `[label](url)`, with whichever half still needs typing left selected. */
export function insertLink(state: SelectionState): SelectionState {
	const { value, start, end } = state;
	const selected = value.slice(start, end);

	// A selected URL becomes the target, since the label is the missing half.
	if (/^https?:\/\/\S+$/.test(selected)) {
		return {
			value: `${value.slice(0, start)}[text](${selected})${value.slice(end)}`,
			start: start + 1,
			end: start + 5,
		};
	}

	// Nothing selected: both halves are placeholders, and the label is the one
	// you would type first.
	if (selected === "") {
		return {
			value: `${value.slice(0, start)}[text](url)${value.slice(end)}`,
			start: start + 1,
			end: start + 5,
		};
	}

	const next = `${value.slice(0, start)}[${selected}](url)${value.slice(end)}`;
	return {
		value: next,
		start: start + selected.length + 3,
		end: start + selected.length + 6,
	};
}

/* -------------------------------------------------------------------------- */
/* Line commands                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rewrites the full lines the selection touches, and selects the result — a
 * line edit changes lengths line by line, and "the block you just changed" is
 * the one selection that stays honest through that.
 */
function editLines(
	state: SelectionState,
	transform: (lines: string[]) => string[],
): SelectionState {
	const { value, start, end } = state;
	const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
	const found = value.indexOf("\n", end);
	const lineEnd = found === -1 ? value.length : found;

	const replaced = transform(value.slice(lineStart, lineEnd).split("\n")).join("\n");
	return {
		value: value.slice(0, lineStart) + replaced + value.slice(lineEnd),
		start: lineStart,
		end: lineStart + replaced.length,
	};
}

const BULLET = /^\s*[-*+] /;
const NUMBERED = /^\s*\d+[.)] /;
const QUOTED = /^ {0,3}> ?/;
const HEADED = /^(#{1,6}) /;

/** Lines that are only whitespace are left alone — a `- ` on a blank line
 * between paragraphs of one item is what breaks the list in half. */
function eachContentLine(lines: string[], edit: (line: string) => string): string[] {
	const content = lines.filter((line) => line.trim() !== "");
	if (content.length === 0) return lines.length === 0 ? [edit("")] : lines.map(edit);
	return lines.map((line) => (line.trim() === "" ? line : edit(line)));
}

export function toggleBulletList(state: SelectionState): SelectionState {
	return editLines(state, (lines) => {
		const content = lines.filter((line) => line.trim() !== "");
		const listed = content.length > 0 && content.every((line) => BULLET.test(line));
		return eachContentLine(lines, (line) =>
			listed ? line.replace(BULLET, "") : `- ${line.replace(NUMBERED, "")}`,
		);
	});
}

export function toggleNumberedList(state: SelectionState): SelectionState {
	return editLines(state, (lines) => {
		const content = lines.filter((line) => line.trim() !== "");
		const listed = content.length > 0 && content.every((line) => NUMBERED.test(line));
		let ordinal = 0;
		return eachContentLine(lines, (line) =>
			listed ? line.replace(NUMBERED, "") : `${++ordinal}. ${line.replace(BULLET, "")}`,
		);
	});
}

export function toggleQuote(state: SelectionState): SelectionState {
	return editLines(state, (lines) => {
		const content = lines.filter((line) => line.trim() !== "");
		const quoted = content.length > 0 && content.every((line) => QUOTED.test(line));
		// Blank lines are quoted too: `>` on the gap is what keeps a two-
		// paragraph quote one quote.
		return lines.map((line) => (quoted ? line.replace(QUOTED, "") : `> ${line}`));
	});
}

/**
 * `##`, one more `#` per press, back to plain past `###` — one button covers
 * every level anyone titles a comment section with.
 */
export function cycleHeading(state: SelectionState): SelectionState {
	return editLines(state, (lines) => {
		const current = HEADED.exec(lines[0] ?? "");
		const level = current === null ? 0 : current[1]!.length;
		const target = level === 0 ? "## " : level >= 3 ? "" : `${"#".repeat(level + 1)} `;
		return eachContentLine(lines, (line) => target + line.replace(HEADED, ""));
	});
}

const FENCE = /^ {0,3}(?:```|~~~)/;

/**
 * Fence the selected lines, or unfence a selection that is a fenced block.
 * An empty selection becomes an empty block with the caret inside it, ready
 * for the paste that prompted the click.
 */
export function toggleCodeBlock(state: SelectionState): SelectionState {
	const { value, start, end } = state;
	const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
	const found = value.indexOf("\n", end);
	const lineEnd = found === -1 ? value.length : found;
	const lines = value.slice(lineStart, lineEnd).split("\n");

	if (lines.length >= 2 && FENCE.test(lines[0]!) && FENCE.test(lines.at(-1)!)) {
		const inner = lines.slice(1, -1).join("\n");
		return {
			value: value.slice(0, lineStart) + inner + value.slice(lineEnd),
			start: lineStart,
			end: lineStart + inner.length,
		};
	}

	const block = value.slice(lineStart, lineEnd);
	const fenced = `\`\`\`\n${block}\n\`\`\``;
	return {
		value: value.slice(0, lineStart) + fenced + value.slice(lineEnd),
		start: lineStart + 4,
		end: lineStart + 4 + block.length,
	};
}
