/**
 * Roles that make a non-native element behave like a field. A widget wearing one
 * of these swallows letters the same way an `<input>` does.
 */
const TYPING_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/**
 * True when the key event came from a field, so shortcuts stay out of the way.
 *
 * Pass the event itself where you can: it also covers IME composition and the
 * case where a field inside a shadow root retargets the event to its host.
 */
export function isTyping(source: KeyboardEvent | EventTarget | null): boolean {
	if (source === null) return false;

	if (source instanceof KeyboardEvent) {
		// Mid-composition keystrokes belong to the IME, whatever they land on.
		if (source.isComposing) return true;
		// Retargeting hides the real field behind its host, so the focused element
		// is the second opinion worth asking.
		return isField(source.target) || isField(document.activeElement);
	}

	return isField(source);
}

function isField(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return TYPING_ROLES.has(target.getAttribute("role") ?? "");
}
