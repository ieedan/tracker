/**
 * Subsequence scoring, for the `@` file autocomplete.
 *
 * A repository path is mostly directory names, and the file someone wants is
 * usually named by a few characters from a couple of those segments —
 * `libmcp`, `srvrepo`, `fmts`. Matching a literal substring cannot answer any
 * of those, so the query is matched as a *subsequence*: every character has to
 * appear, in order, but not next to each other.
 *
 * That alone matches far too much, so the alignment is scored rather than
 * merely found. The scoring is the interesting half: `mcp` should land on
 * `src/lib/server/mcp/tools.ts` and not on `src/lib/components/markdown.ts`,
 * even though both contain an `m`, a `c` and a `p` in order. Characters that
 * start a path segment or a word are worth more than characters in the middle
 * of one, characters matched back to back are worth more than characters
 * scattered across a path, and every character skipped between two matches
 * costs.
 *
 * The best alignment is found rather than guessed. A greedy left-to-right scan
 * takes the first `m` it sees, which in `src/lib/components/markdown.ts` is the
 * one inside `components`, and never discovers that starting at `markdown`
 * scores better. So this walks the whole query × path grid, keeping the best
 * score for each place a query character could land, which is `O(query × path)`
 * — small, for a path.
 *
 * Both ends use it: the server ranks candidates with it, and the menu
 * highlights the characters it matched, so the ordering the server chose is
 * legible rather than mysterious.
 */

/** One character landing on the right character, before any bonus. */
const SCORE_MATCH = 16;
/** The very start of the path. */
const BONUS_START = 24;
/** The first character of a path segment — what `@` queries are usually aimed at. */
const BONUS_SEGMENT = 20;
/** After a `-`, `_`, `.` or space: the start of a word inside a name. */
const BONUS_WORD = 14;
/** The `C` of `fileCode`. */
const BONUS_CAMEL = 12;
/** Two query characters landing back to back, which is what a literal substring is. */
const BONUS_CONSECUTIVE = 20;
/** Per character skipped between two matches. */
const PENALTY_GAP = 3;
/** A match that fits inside the basename over the same characters spread down the path. */
const BONUS_BASENAME = 24;
/** How much a path's length tells against it, when two match equally well. */
const LENGTH_DIVISOR = 8;

export interface FuzzyMatch {
	score: number;
	/** Indices into the target that the query landed on, ascending. */
	positions: number[];
}

const CODE_ZERO = 48;
const CODE_NINE = 57;
const CODE_UPPER_A = 65;
const CODE_UPPER_Z = 90;
const CODE_LOWER_A = 97;
const CODE_LOWER_Z = 122;

/** What the character before this one says about it. */
function bonusAt(target: string, index: number): number {
	if (index === 0) return BONUS_START;

	const previous = target.charCodeAt(index - 1);
	if (previous === 47 /* / */) return BONUS_SEGMENT;
	if (
		previous === 45 /* - */ ||
		previous === 95 /* _ */ ||
		previous === 46 /* . */ ||
		previous === 32 /*   */
	) {
		return BONUS_WORD;
	}

	const current = target.charCodeAt(index);
	const isUpper = current >= CODE_UPPER_A && current <= CODE_UPPER_Z;
	const afterLower =
		(previous >= CODE_LOWER_A && previous <= CODE_LOWER_Z) ||
		(previous >= CODE_ZERO && previous <= CODE_NINE);
	return isUpper && afterLower ? BONUS_CAMEL : 0;
}

/**
 * The best-scoring way to read `query` out of `target`, or null if it is not in
 * there at all. Case-insensitive; `positions` indexes into `target` as given.
 *
 * `best[j]` holds the score of the best alignment whose *current* query
 * character sits at target index `j`, and it is rebuilt once per query
 * character. Each cell either extends the previous character's cell next door —
 * a consecutive run — or jumps from the best cell further back, paying for the
 * characters skipped on the way. That "best cell further back" is carried along
 * the row instead of being searched for, which is what keeps this linear in the
 * path rather than quadratic.
 */
export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
	if (query === "") return { score: 0, positions: [] };
	if (query.length > target.length) return null;

	const needle = query.toLowerCase();
	const haystack = target.toLowerCase();
	const width = haystack.length;
	const height = needle.length;

	const bonus = new Int32Array(width);
	for (let index = 0; index < width; index++) bonus[index] = bonusAt(target, index);

	// Where the previous query character sat, for every cell, so the winning
	// alignment can be walked back out once the best ending is known.
	const from = new Int32Array(height * width).fill(-1);

	let previous = new Float64Array(width);
	let current = new Float64Array(width);
	let reachable = false;
	for (let index = 0; index < width; index++) {
		const hit = haystack[index] === needle[0];
		previous[index] = hit ? SCORE_MATCH + bonus[index]! : Number.NEGATIVE_INFINITY;
		reachable ||= hit;
	}
	if (!reachable) return null;

	for (let row = 1; row < height; row++) {
		// The best cell of the previous row at least two columns back, already
		// charged for every character skipped since. Kept as a running value:
		// moving one column right ages it by one gap and folds in the column that
		// just fell out of reach.
		let carried = Number.NEGATIVE_INFINITY;
		let carriedFrom = -1;
		reachable = false;

		for (let column = 0; column < width; column++) {
			let score = Number.NEGATIVE_INFINITY;
			let source = -1;

			if (haystack[column] === needle[row]) {
				const adjacent = column > 0 ? previous[column - 1]! : Number.NEGATIVE_INFINITY;
				if (adjacent > Number.NEGATIVE_INFINITY) {
					score = adjacent + BONUS_CONSECUTIVE;
					source = column - 1;
				}
				if (carried > score) {
					score = carried;
					source = carriedFrom;
				}
				if (score > Number.NEGATIVE_INFINITY) {
					score += SCORE_MATCH + bonus[column]!;
					reachable = true;
				}
			}

			current[column] = score;
			from[row * width + column] = source;

			// Age the carry by one column and let column-1 into it, which is now
			// far enough back that landing here would be a jump rather than a run.
			if (column >= 1) {
				const candidate = previous[column - 1]!;
				if (candidate > carried) {
					carried = candidate;
					carriedFrom = column - 1;
				}
				if (carried > Number.NEGATIVE_INFINITY) carried -= PENALTY_GAP;
			}
		}

		if (!reachable) return null;

		const swap = previous;
		previous = current;
		current = swap;
	}

	let bestScore = Number.NEGATIVE_INFINITY;
	let bestColumn = -1;
	for (let column = 0; column < width; column++) {
		if (previous[column]! > bestScore) {
			bestScore = previous[column]!;
			bestColumn = column;
		}
	}
	if (bestColumn === -1) return null;

	const positions: number[] = Array.from({ length: height }, () => -1);
	let column = bestColumn;
	for (let row = height - 1; row >= 0; row--) {
		positions[row] = column;
		column = from[row * width + column]!;
	}

	return { score: bestScore, positions };
}

/**
 * How well a repository path answers what someone typed after `@`.
 *
 * Scored twice — once against the whole path, once against just the basename —
 * because `schema` meaning `schema.server.ts` is the common case and `schema`
 * meaning "something under `src/schema/`" is the rarer one. The basename read
 * carries a bonus so it wins a tie, and its positions are lifted back into path
 * coordinates so the caller never has to know which read won.
 *
 * An empty query matches everything, scoring only on length, so the menu can
 * open with something in it the moment `@` is typed.
 */
export function rankPath(query: string, path: string): FuzzyMatch | null {
	const trimmed = query.trim();
	// Between two paths that match equally well, the shallower one is meant.
	const lengthPenalty = path.length / LENGTH_DIVISOR;
	if (trimmed === "") return { score: -lengthPenalty, positions: [] };

	let best = fuzzyScore(trimmed, path);

	const slash = path.lastIndexOf("/");
	if (slash !== -1) {
		const basename = fuzzyScore(trimmed, path.slice(slash + 1));
		if (basename !== null && (best === null || basename.score + BONUS_BASENAME > best.score)) {
			best = {
				score: basename.score + BONUS_BASENAME,
				positions: basename.positions.map((index) => index + slash + 1),
			};
		}
	}

	if (best === null) return null;
	return { score: best.score - lengthPenalty, positions: best.positions };
}
