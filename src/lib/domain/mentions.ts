// Finding issue identifiers in text somebody else wrote — a pull request title,
// its description, a branch name. Shared between the API and the browser, so no
// server imports may ever appear here.

/**
 * The words that mean "this pull request finishes that issue".
 *
 * The same set GitHub honours in a pull request body, so a description written
 * for GitHub keeps working here rather than needing a second, tracker-specific
 * incantation next to it.
 */
const CLOSING_KEYWORDS = /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)$/i;

/**
 * An optional closing keyword, then something shaped like `ENG-42`.
 *
 * The key half is deliberately loose — 1–6 alphanumerics starting with a letter,
 * which is every team key that can exist and also `UTF-8`. Narrowing it here is
 * not possible, because which keys are real is a property of a workspace rather
 * than of the grammar; the caller filters against the keys it actually has.
 */
const MENTION =
	/(?:\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+)?\b([A-Za-z][A-Za-z0-9]{0,5})-(\d+)\b/gi;

export interface IssueMention {
	/** Upper-cased, the way a team key is stored — `eng-42` and `ENG-42` are one issue. */
	key: string;
	number: number;
	identifier: string;
	/** True when at least one mention of it was preceded by a closing keyword. */
	closes: boolean;
}

/**
 * Every issue a piece of text names, de-duplicated.
 *
 * A pull request that says "fixes ENG-42" in the body and "ENG-42" again in the
 * title is one mention that closes, not two that disagree — so `closes` is the
 * union across occurrences rather than whatever the last one happened to say.
 */
export function findIssueMentions(text: string): IssueMention[] {
	const found = new Map<string, IssueMention>();

	for (const match of text.matchAll(MENTION)) {
		const keyword = match[1];
		const key = match[2]!.toUpperCase();
		const number = Number(match[3]);
		if (!Number.isSafeInteger(number) || number < 1) continue;

		const identifier = `${key}-${number}`;
		const closes = keyword !== undefined && CLOSING_KEYWORDS.test(keyword);
		const existing = found.get(identifier);

		if (existing === undefined) {
			found.set(identifier, { key, number, identifier, closes });
		} else if (closes) {
			existing.closes = true;
		}
	}

	return [...found.values()];
}

/**
 * The mentions in a pull request, read from every place people put them, in the
 * order somebody skimming it would find them: title, then description, then
 * branch.
 *
 * Where the identifier appears is what separates naming an issue from claiming
 * it. A title or a branch named `ENG-61` says this pull request *is* that work —
 * nobody titles a pull request after an issue they are merely referring to — so
 * those close it as surely as writing "fixes" would. In a description they might
 * be doing either, which is what the keyword is for: "fixes ENG-42" closes,
 * "see also ENG-40" does not.
 */
export function pullRequestMentions(pull: {
	title: string;
	body: string;
	headRef: string;
}): IssueMention[] {
	const found = new Map<string, IssueMention>();

	const add = (mentions: IssueMention[], claims: boolean) => {
		for (const mention of mentions) {
			const existing = found.get(mention.identifier);
			const closes = claims || mention.closes;
			if (existing === undefined) {
				found.set(mention.identifier, { ...mention, closes });
			} else if (closes) {
				existing.closes = true;
			}
		}
	};

	add(findIssueMentions(pull.title), true);
	add(findIssueMentions(pull.body), false);
	add(findIssueMentions(pull.headRef), true);

	return [...found.values()];
}
