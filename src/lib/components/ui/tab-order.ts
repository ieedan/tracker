/**
 * Tab inside a modal, moving only to controls that are actually there.
 *
 * The dialog primitive traps Tab itself, but the stops it collects come out of
 * a plain `querySelectorAll` — which counts controls that are in the DOM
 * without being on screen. Two of those turn up all over this app: the hidden
 * `<input type="file">` behind the attachment paperclip, and the filter box
 * every picker keeps inside its own menu while that menu is closed — one
 * between each pair of pills. Focus was handed to the first of those,
 * `focus()` on an unrendered element does nothing, and because the trap had
 * already called `preventDefault()` the caret never moved: Tab looked dead.
 *
 * `TabOrder` wraps a panel's children in a `display: contents` element that
 * owns Tab and hands it to the next control that can really take it. It sits
 * inside the panel, so it runs before the primitive's own handler — which is
 * the only place it can run at all, since the primitive composes a caller's
 * `onKeydown` *after* its trap and skips it once the default is prevented.
 */
import { Div, ref, type Child } from "@implementjs/core";

/** What Tab could land on, before asking whether it is rendered. */
const TAB_STOP = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]",
].join(",");

/** What Tab can land on inside `root`, in the order Tab visits it. */
function tabStops(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(TAB_STOP)).filter(
		// `tabIndex` is the resolved value, so `-1` is excluded however it was
		// set, and a box with no layout is one nothing can put focus in.
		(element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
	);
}

/** An open menu owns Tab — it closes on it. Only the panel's own surface is ours. */
const FLOATING = "[data-dropdown-menu-content], [data-dropdown-menu-sub-content]";

/**
 * Tab moves to the next control that is actually there.
 *
 * Two things still come first: anything that claims Tab and stops the event
 * before it gets here — the composer's `@` menu completing a mention — and any
 * open picker menu, which closes on Tab rather than tabbing within itself. The
 * primitive's trap is the handler above this one and would move focus a second
 * time, so a Tab handled here is stopped as well.
 */
function moveFocus(event: KeyboardEvent, surface: HTMLElement | null): void {
	if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
	const from = event.target;
	if (surface === null || !(from instanceof HTMLElement)) return;
	if (from.closest(FLOATING) !== null) return;

	const stops = tabStops(surface);
	const index = stops.indexOf(from);
	// Focus is on something the list does not know about; leave it to the panel.
	if (index === -1) return;

	const next = stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
	if (next === undefined) return;
	event.preventDefault();
	event.stopPropagation();
	next.focus();
}

/**
 * Everything inside a modal panel, as one element, so Tab has somewhere to sit.
 *
 * `display: contents` — the children stay the panel's own grid or flex items,
 * so wrapping them changes nothing about how the panel is laid out.
 */
export function TabOrder(...children: Child[]) {
	const surface = ref<HTMLDivElement>();

	return Div(
		{
			this: surface,
			class: "contents",
			onKeydown: (event) => moveFocus(event, surface.get()),
		},
		...children,
	);
}
