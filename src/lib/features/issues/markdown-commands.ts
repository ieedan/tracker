/**
 * The composer's keyboard commands, as pure functions over the body.
 *
 * ⌘B, ⌘I, ⌘E and ⌘K write markdown into the source the way typing the markers
 * would, and the editor redraws from the result — so a shortcut and the
 * characters it stands for are the same edit, and neither needs anything from
 * the DOM: value in, value out, with the selection that should follow.
 *
 * The block commands a toolbar would have needed — headings, lists, quotes,
 * fenced blocks — are not here, because `# `, `- `, `> ` and ``` typed into
 * the box already do them.
 *
 * Every command toggles. Bold on bold text unbolds it — a shortcut that can
 * only add is one you press twice and then reach for undo.
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
