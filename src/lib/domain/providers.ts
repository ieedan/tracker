// The provider vocabulary, shared by the API, the settings UI and the issue
// views. No server imports — the browser renders repository names and pull
// request states too.

/**
 * Where a repository lives.
 *
 * Only GitHub is implemented. The list exists so that adding GitLab is a new
 * adapter and one more entry rather than a search for every place `"github"`
 * was hardcoded — the seam is cheap now and expensive later.
 */
export const GIT_PROVIDERS = ["github"] as const;
export type GitProviderId = (typeof GIT_PROVIDERS)[number];

export const GIT_PROVIDER_LABELS: Record<GitProviderId, string> = {
	github: "GitHub",
};

/** The states a pull request can be in, flattened from provider vocabularies. */
export const PULL_REQUEST_STATES = ["open", "merged", "closed", "draft"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export const PULL_REQUEST_STATE_LABELS: Record<PullRequestState, string> = {
	open: "Open",
	merged: "Merged",
	closed: "Closed",
	draft: "Draft",
};

/** Tailwind text colors, matching what each provider uses for the same state. */
export const PULL_REQUEST_STATE_COLORS: Record<PullRequestState, string> = {
	open: "text-emerald-500",
	merged: "text-violet-500",
	closed: "text-muted-foreground",
	draft: "text-muted-foreground",
};

/** How the file index describes itself while it is being built. */
export const INDEX_STATES = ["never", "indexing", "ready", "failed"] as const;
export type IndexState = (typeof INDEX_STATES)[number];

/**
 * `owner/name#12` and full URLs both resolve to the same thing.
 *
 * Accepting the URL matters because that is what is on the clipboard when
 * somebody has a pull request open in another tab.
 */
export function parsePullRequestRef(
	value: string,
): { owner: string; name: string; number: number } | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;

	const url = /^https?:\/\/[^/]+\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(trimmed);
	if (url !== null) {
		return { owner: url[1]!, name: url[2]!, number: Number(url[3]) };
	}

	const short = /^([^/\s]+)\/([^/\s#]+)#(\d+)$/.exec(trimmed);
	if (short !== null) {
		return { owner: short[1]!, name: short[2]!, number: Number(short[3]) };
	}

	return null;
}

/** `#12` alone, for when the issue already knows which repository it is scoped to. */
export function parseBareNumber(value: string): number | null {
	const match = /^#?(\d+)$/.exec(value.trim());
	if (match === null) return null;
	const number = Number(match[1]);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}
