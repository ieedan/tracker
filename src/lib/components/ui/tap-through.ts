/**
 * A tap that dismisses a modal must not also click the page behind it.
 *
 * The scrim covers the viewport, so a tap outside the panel lands on it, and
 * the dismissable layer closes the modal on `pointerdown` — while the finger
 * is still down. What happens next is not the scrim's doing: an element whose
 * `display` is transitioning to `none` (`transition-discrete`, which is what
 * lets the scrim fade out instead of vanishing) is still painted but is no
 * longer hit-tested, for the whole length of the transition. So the click the
 * browser sends once the finger lifts misses the scrim and lands on whatever
 * the scrim was covering: the issue row under the tap opens while the sheet is
 * still sliding away (ENG-69).
 *
 * A mouse never shows it. `mousedown` on the scrim and `mouseup` on the row
 * below put the click on their common ancestor, so nothing under the pointer
 * hears it. A touchscreen dispatches the click straight at the point that was
 * tapped, so it does — which is why this only ever happened on a phone.
 *
 * The fix is for the scrim to swallow that click itself, from the
 * `pointerdown` that dismisses it until the click the same gesture produces.
 */

/**
 * How far the click may sit from the press and still be the same tap. A finger
 * rolls a few pixels between touching the glass and leaving it; a deliberate
 * second tap somewhere else is not going to land inside this.
 */
const TAP_SLOP = 24;

/**
 * How long to keep waiting after the finger lifts. A tap's click follows the
 * release immediately, so this is only the way out for the gestures that never
 * produce one — a scroll, a swipe, a press that ends off-screen.
 */
const CLICK_WINDOW = 350;

/** Disarms the guard currently waiting for a click, if there is one. */
let disarm: (() => void) | null = null;

/**
 * Eat the click that this `pointerdown` is about to produce. Call it from a
 * scrim's `onPointerdown`: by the time the click arrives the scrim has stopped
 * hit-testing, so this is the only thing standing between the gesture and the
 * page underneath.
 */
export function swallowTapThrough(event: PointerEvent): void {
	// A second press replaces the first — only ever one guard armed.
	disarm?.();

	const { clientX, clientY } = event;
	const controller = new AbortController();
	const { signal } = controller;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const stop = () => {
		clearTimeout(timer);
		controller.abort();
		if (disarm === stop) disarm = null;
	};
	disarm = stop;

	document.addEventListener(
		"click",
		(clicked) => {
			// Not this gesture's click: leave it to whoever it was meant for.
			if (
				Math.abs(clicked.clientX - clientX) > TAP_SLOP ||
				Math.abs(clicked.clientY - clientY) > TAP_SLOP
			) {
				return;
			}
			// Capture phase on the document, so this is the first listener the
			// click reaches and no handler further down gets a look at it.
			clicked.preventDefault();
			clicked.stopImmediatePropagation();
			stop();
		},
		{ capture: true, signal },
	);
	document.addEventListener(
		"pointerup",
		() => {
			timer = setTimeout(stop, CLICK_WINDOW);
		},
		{ capture: true, once: true, signal },
	);
	document.addEventListener("pointercancel", stop, { capture: true, once: true, signal });
}
