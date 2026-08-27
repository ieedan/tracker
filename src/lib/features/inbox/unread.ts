/**
 * The inbox badge's count, shared between the shell that shows it and the inbox
 * that changes it.
 *
 * It used to be a signal private to `app-shell.ts`, seeded from the layout load
 * and refreshed on a 15s poll. That leaves the badge wrong for up to a poll on
 * the one screen where both are visible at once: reading a notification empties
 * the inbox in front of you while the sidebar still claims there are five.
 *
 * So the count lives here instead. The shell seeds and polls into it, and the
 * inbox moves it the moment a read is applied locally — before the request that
 * persists it has come back, and rolled back with the list if it fails.
 *
 * A module-level signal is per-process, which on the server means it is shared
 * between requests. Nothing reads it there outside the synchronous render that
 * seeds it — the shell seeds while building its own tree — so a value never
 * outlives the request that set it.
 */
import { signal, type Readable } from "@implementjs/core";

const count = signal(0);

/** What the sidebar badge renders. */
export const unreadCount: Readable<number> = count;

/**
 * The authoritative number, from a page load or a poll. Anything negative is a
 * bug upstream, not a badge that counts backwards.
 */
export function seedUnreadCount(next: number): void {
	count.set(Math.max(0, next));
}

/**
 * Moves the count by `delta`, floored at zero — what the inbox calls when it
 * flips read state on notifications it is holding.
 *
 * A delta rather than a fresh total, because the inbox only ever has a page of
 * the notifications the badge is counting: it knows how many it just changed,
 * not how many are left.
 */
export function adjustUnreadCount(delta: number): void {
	count.update((current) => Math.max(0, current + delta));
}
