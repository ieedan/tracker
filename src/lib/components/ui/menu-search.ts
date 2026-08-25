/**
 * Type-to-filter and Linear-style hotkeys for menus.
 *
 * This is deliberately DOM-driven rather than prop-driven: the menu primitive
 * already finds its rows with `querySelectorAll`, so working the same way lets
 * one flag on `DropdownMenuContent` light up every call site — rows built by
 * hand, by `ForEach`, radio rows, checkbox rows — without any of them knowing.
 *
 * Behaviour, once `search` is on:
 *   - the box takes focus every time the menu opens, and empties itself;
 *   - typing filters the rows, anywhere focus happens to be — a keystroke on a
 *     row is routed back into the box, so the menu's own first-letter
 *     typeahead never competes with the query;
 *   - Up/Down move into the rows and walk them, Enter takes the first match,
 *     Escape closes (the dismissable layer's job, so it is left alone).
 *
 * And with `hotkeys` on, the rows are numbered from the right and the digit
 * picks the row outright — but only while the query is empty, otherwise a
 * digit is just a character someone is trying to search for. The hints hide
 * themselves for exactly as long as that is true.
 */
import {
	Div,
	If,
	ImplementLifecycle,
	Input as InputElement,
	ref,
	signal,
	type Child,
	type Ref,
	type Signal,
} from "@implementjs/core";
import { SearchIcon } from "@implementjs/lucide";

/** The digits handed out, in order, to rows that do not name their own key. */
const AUTO_HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/**
 * Scoped to the dropdown flavor of the menu primitive. Context menus and
 * menubars use `data-context-menu-*` / `data-menubar-*` and would need their
 * own scope; neither hosts a picker today.
 */
const ITEM_SELECTOR = "[data-dropdown-menu-item]";
const BOUNDARY_SELECTOR = "[data-dropdown-menu-content], [data-dropdown-menu-sub-content]";
const HEADING_SELECTOR = "[data-dropdown-menu-group-heading]";
const HOTKEY_SELECTOR = ":scope > [data-slot='menu-hotkey']";

/** Set by the filter on rows it hid, so it only re-enables its own. */
const HIDDEN_ATTR = "data-search-hidden";
/** The key a row currently answers to. Absent while a query is running. */
const HOTKEY_ATTR = "data-hotkey-active";

/** `Kbd`'s look, written out: the hint is built with `createElement`, not mounted. */
const HOTKEY_CLASS =
	"ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground select-none";

export type MenuSearchOptions = {
	/** A filter box at the top of the menu. `true` uses a generic placeholder. */
	search?: boolean | string;
	/** Number the rows and let the digit pick one outright. */
	hotkeys?: boolean;
};

/**
 * The three nodes a searchable menu needs. They are separate because they do
 * not sit together: the header goes above the caller's children and the empty
 * state below them.
 */
export type MenuSearchParts = {
	/** Attaches the behaviour; mount it inside the content element. */
	behavior: Child;
	/** The filter box, or `null` when only hotkeys were asked for. */
	header: Child;
	/** "No results", shown when the query matches nothing. */
	empty: Child;
};

export function menuSearch({
	search = false,
	hotkeys = false,
}: MenuSearchOptions): MenuSearchParts {
	if (search === false && !hotkeys) {
		return { behavior: null, header: null, empty: null };
	}

	const inputRef = ref<HTMLInputElement>();
	const noResults = signal(false);
	const controller = createController(inputRef, noResults, hotkeys);

	return {
		behavior: ImplementLifecycle({ onMount: (content) => controller.attach(content) }),
		header: search === false ? null : SearchRow(inputRef, controller, search),
		empty: If(
			noResults,
			Div({ class: "px-2 py-4 text-center text-[13px] text-muted-foreground" }, "No results"),
		),
	};
}

function SearchRow(
	inputRef: Ref<HTMLInputElement>,
	controller: Controller,
	search: true | string,
): Child {
	return Div(
		{
			"data-slot": "menu-search",
			class: "-mx-1 -mt-1 mb-1 flex items-center gap-2 border-b border-border px-2",
			// Clicking the box must not reach the rows behind it.
			onPointerdown: (event) => event.stopPropagation(),
		},
		SearchIcon({ "aria-hidden": true, class: "size-3.5 shrink-0 text-muted-foreground" }),
		InputElement({
			this: inputRef,
			type: "text",
			autocomplete: "off",
			"data-slot": "menu-search-input",
			"aria-label": "Filter",
			placeholder: search === true ? "Search…" : search,
			class:
				"h-8 w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground",
			onInput: () => controller.schedule(),
			onKeydown: (event) => controller.onInputKeydown(event),
		}),
	);
}

type Controller = {
	attach: (content: HTMLElement) => () => void;
	schedule: () => void;
	onInputKeydown: (event: KeyboardEvent) => void;
};

function createController(
	inputRef: Ref<HTMLInputElement>,
	noResults: Signal<boolean>,
	hotkeys: boolean,
): Controller {
	let content: HTMLElement | null = null;
	let observer: MutationObserver | null = null;
	let frame: number | null = null;
	let wasOpen = false;

	const query = () => inputRef.get()?.value.trim().toLowerCase() ?? "";

	const rows = () => (content === null ? [] : menuRows(content));

	const visibleRows = () => rows().filter((row) => !row.hasAttribute(HIDDEN_ATTR));

	/**
	 * One pass over the rows: hide what the query excludes, then hand out the
	 * hotkeys. Idempotent, because the observer below re-runs it after its own
	 * writes and it has to settle.
	 */
	const apply = () => {
		if (content === null) return;
		const q = query();
		const list = menuRows(content);
		let visible = 0;

		list.forEach((row, index) => {
			const matches = q === "" || rowLabel(row).toLowerCase().includes(q);
			setRowHidden(row, !matches);
			if (matches) visible += 1;
			if (!hotkeys) return;
			// Keys stay pinned to the row, not to its position in the results,
			// and go away entirely while a query is doing the narrowing.
			const key = row.getAttribute("data-hotkey") ?? AUTO_HOTKEYS[index] ?? null;
			setRowHotkey(row, q === "" ? key : null);
		});

		syncHeadings(content);
		noResults.set(visible === 0 && list.length > 0);
	};

	const schedule = () => {
		if (frame !== null || content === null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			if (content === null) return;
			// Drop the records our own last pass queued, so they cannot be
			// mistaken for someone else's change.
			observer?.takeRecords();
			const isOpen = content.getAttribute("data-state") === "open";
			if (isOpen && !wasOpen) reset();
			wasOpen = isOpen;
			apply();
		});
	};

	/** A menu opens on a clean query, with the box ready to take one. */
	const reset = () => {
		const input = inputRef.get();
		if (input === null) return;
		input.value = "";
		// The primitive puts focus on the first row (keyboard) or the panel
		// (pointer) a microtask after opening; this runs on the next frame, so
		// it lands last and the box wins.
		input.focus();
	};

	const pickHotkey = (key: string) => {
		const wanted = key.toLowerCase();
		return visibleRows().find((row) => row.getAttribute(HOTKEY_ATTR)?.toLowerCase() === wanted);
	};

	/**
	 * Runs on the way down, before the panel's own keydown, so a keystroke can
	 * be claimed before the menu's typeahead ever sees it.
	 */
	const onContentKeydown = (event: KeyboardEvent) => {
		if (content === null || event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		// A submenu owns its own keys.
		if (target.closest(BOUNDARY_SELECTOR) !== content) return;

		const input = inputRef.get();
		const inInput = input !== null && target === input;

		if (event.key === "Enter" && inInput) {
			const first = visibleRows()[0];
			if (first === undefined) return;
			event.preventDefault();
			event.stopPropagation();
			first.click();
			return;
		}

		if (event.key.length === 1) {
			if (hotkeys && query() === "") {
				const row = pickHotkey(event.key);
				if (row !== undefined) {
					event.preventDefault();
					event.stopPropagation();
					row.click();
					return;
				}
			}
			// The box is the target: leave the event alone so the character
			// lands, and let the input's own handler stop it going further.
			if (input === null || inInput) return;
			event.preventDefault();
			event.stopPropagation();
			input.focus();
			input.value += event.key;
			schedule();
			return;
		}

		// Backspace on a row rubs out the last character of the query.
		if (event.key === "Backspace" && input !== null && !inInput && input.value !== "") {
			event.preventDefault();
			event.stopPropagation();
			input.focus();
			input.value = input.value.slice(0, -1);
			schedule();
		}
	};

	/**
	 * On the box itself, so it fires at the target and stops the event before
	 * the panel's typeahead — and before the app's single-letter shortcuts —
	 * can read a field someone is typing into. Up/Down and Escape are left to
	 * travel: the menu moves focus into the rows, the layer closes.
	 */
	const onInputKeydown = (event: KeyboardEvent) => {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (inputOwnsKey(event.key)) event.stopPropagation();
	};

	const attach = (element: HTMLElement) => {
		content = element;
		// Left false even for a menu that mounts open, so that counts as an
		// opening and the box still takes focus.
		wasOpen = false;
		element.addEventListener("keydown", onContentKeydown, true);
		observer = new MutationObserver(() => schedule());
		observer.observe(element, {
			attributes: true,
			attributeFilter: ["data-state"],
			childList: true,
			subtree: true,
		});
		schedule();

		return () => {
			element.removeEventListener("keydown", onContentKeydown, true);
			observer?.disconnect();
			observer = null;
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
			content = null;
		};
	};

	return { attach, schedule, onInputKeydown };
}

/** Keys the filter box keeps for itself; everything else may travel. */
function inputOwnsKey(key: string): boolean {
	if (key.length === 1) return true;
	return (
		key === "Backspace" ||
		key === "Delete" ||
		key === "Home" ||
		key === "End" ||
		key === "ArrowLeft" ||
		key === "ArrowRight"
	);
}

/** This menu's own rows — the ones nested in a submenu belong to that submenu. */
function menuRows(content: HTMLElement): HTMLElement[] {
	return Array.from(content.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
		(row) => row.closest(BOUNDARY_SELECTOR) === content,
	);
}

/** What a row reads as, ignoring the hotkey hint hanging off its right. */
function rowLabel(row: HTMLElement): string {
	const explicit = row.getAttribute("data-label");
	if (explicit !== null) return explicit;
	let text = "";
	for (const node of row.childNodes) {
		if (node instanceof HTMLElement && node.dataset.slot === "menu-hotkey") continue;
		text += node.textContent ?? "";
	}
	return text.trim();
}

/**
 * `data-disabled` comes along for the ride because the primitive skips
 * disabled rows when it walks the list — without it the arrow keys would step
 * onto rows nobody can see. Rows already disabled by their caller are left
 * marked when they come back.
 */
function setRowHidden(row: HTMLElement, hidden: boolean) {
	if (hidden) {
		row.style.display = "none";
		if (row.hasAttribute(HIDDEN_ATTR)) return;
		row.setAttribute(HIDDEN_ATTR, "");
		if (!row.hasAttribute("data-disabled")) row.setAttribute("data-disabled", "");
		else row.setAttribute("data-was-disabled", "");
		return;
	}
	if (!row.hasAttribute(HIDDEN_ATTR)) return;
	row.style.removeProperty("display");
	row.removeAttribute(HIDDEN_ATTR);
	if (row.hasAttribute("data-was-disabled")) row.removeAttribute("data-was-disabled");
	else row.removeAttribute("data-disabled");
}

function setRowHotkey(row: HTMLElement, key: string | null) {
	const existing = row.querySelector<HTMLElement>(HOTKEY_SELECTOR);
	if (key === null) {
		existing?.remove();
		row.removeAttribute(HOTKEY_ATTR);
		return;
	}
	if (row.getAttribute(HOTKEY_ATTR) !== key) row.setAttribute(HOTKEY_ATTR, key);
	if (existing !== null) {
		if (existing.textContent !== key) existing.textContent = key;
		return;
	}
	const hint = document.createElement("span");
	hint.dataset.slot = "menu-hotkey";
	hint.className = HOTKEY_CLASS;
	hint.setAttribute("aria-hidden", "true");
	hint.textContent = key;
	row.append(hint);
}

/** A heading whose whole group has been filtered away goes with it. */
function syncHeadings(content: HTMLElement) {
	for (const heading of content.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
		const group = heading.parentElement;
		if (group === null) continue;
		const survivor = group.querySelector(`${ITEM_SELECTOR}:not([${HIDDEN_ATTR}])`);
		if (survivor === null) heading.style.display = "none";
		else heading.style.removeProperty("display");
	}
}
