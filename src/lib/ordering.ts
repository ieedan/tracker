/**
 * Fractional indexing: an issue's place in a list is a string that sorts
 * lexicographically, so moving one issue writes one row instead of renumbering
 * everything below it.
 *
 * Keys are base-62 digits ordered by ASCII (`0-9`, `A-Z`, `a-z`), which matches
 * how Postgres compares `text` under the `C` collation the identifier column
 * uses.
 *
 * The one invariant that makes this work: **a key never ends in the smallest
 * digit**. Without it there would be no room below a key like `"10"`, because
 * every candidate (`"0…"`) is already at the floor. Keeping the last digit
 * above the floor guarantees an unbounded supply of keys on both sides.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const MIN = DIGITS[0]!;

/**
 * A key strictly between `before` and `after`, where `before` is `""` for the
 * start of the list and `after` is `null` for the end.
 */
function midpoint(before: string, after: string | null): string {
	if (after !== null && before >= after) {
		throw new Error(`ordering: "${before}" is not before "${after}"`);
	}
	if (before.endsWith(MIN) || after?.endsWith(MIN) === true) {
		throw new Error(`ordering: key ends in "${MIN}", which breaks the ordering invariant`);
	}

	if (after !== null) {
		// Anything the two keys share is carried through untouched, and the search
		// continues on the first position where they actually differ.
		let shared = 0;
		while ((before[shared] ?? MIN) === after[shared]) shared += 1;
		if (shared > 0) {
			return after.slice(0, shared) + midpoint(before.slice(shared), after.slice(shared));
		}
	}

	const low = before === "" ? 0 : DIGITS.indexOf(before[0]!);
	const high = after === null ? BASE : DIGITS.indexOf(after[0]!);

	// There is room between the two digits: land in the middle and stop.
	if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;

	// The digits are adjacent, so the key has to get longer. When `after` has
	// more digits, its first one alone already sits in the gap.
	if (after !== null && after.length > 1) return after.slice(0, 1);

	// Otherwise keep `before`'s digit and find room in the position after it.
	return DIGITS[low]! + midpoint(before.slice(1), null);
}

/**
 * A key that sorts strictly between `before` and `after`. Either bound may be
 * null, meaning the start or the end of the list.
 *
 * Throws when the bounds are equal or inverted — that is a caller bug, and
 * silently returning a duplicate key would corrupt the ordering.
 */
export function between(before: string | null, after: string | null): string {
	return midpoint(before ?? "", after);
}

/** `count` keys in ascending order, appended after `after`. Used when seeding a list. */
export function sequence(count: number, after: string | null = null): string[] {
	const keys: string[] = [];
	let previous = after;
	for (let i = 0; i < count; i += 1) {
		previous = between(previous, null);
		keys.push(previous);
	}
	return keys;
}
