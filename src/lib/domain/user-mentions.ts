// `@someone` in a body — how it is written down, how it is read back, and who
// it names. Shared between the composer, the renderer and the API, so no server
// imports may ever appear here.

/**
 * A mention is a markdown link, the same shape a `@file` reference already
 * takes: `[@Aidan Bleser](/app/tracker?assignee=<id>)`.
 *
 * Nothing new has to be taught to the parser, the serializer or anything that
 * renders a body somewhere this app is not — a webhook payload, a pull request
 * description, the MCP tools. Somewhere that draws pills, it is a pill; anywhere
 * else it is still a person's name with a link under it.
 *
 * The link goes to that person's issues in the workspace rather than to a
 * profile page, because that is the question a mention makes you ask. The id is
 * in the URL rather than in the label so a rename does not orphan the mention:
 * the label is only what it looked like when it was written.
 */
const MENTION_HREF = /^\/app\/([^/?#\s]+)\?assignee=([A-Za-z0-9_-]+)$/;

/** Where a mention points: the workspace's issues, narrowed to that person. */
export function userMentionHref(slug: string, userId: string): string {
	return `/app/${encodeURIComponent(slug)}?assignee=${encodeURIComponent(userId)}`;
}

/** The workspace and person a mention names, or null when the link is not one. */
export function parseUserMentionHref(href: string): { slug: string; userId: string } | null {
	const match = MENTION_HREF.exec(href);
	if (match === null) return null;
	return { slug: decodeURIComponent(match[1]!), userId: match[2]! };
}

/**
 * A name as it can appear inside a link label.
 *
 * Brackets would close the label early and a newline would end the link
 * altogether, so both are taken out. Nobody's name has them; a name that does is
 * still better off drawn without them than breaking the body it was written in.
 */
export function mentionLabel(name: string): string {
	const cleaned = name
		.replaceAll(/[[\]\n\r]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned === "" ? "someone" : cleaned;
}

/** What the `@` menu inserts when a person is picked. */
export function userMentionMarkdown(slug: string, user: { id: string; name: string }): string {
	return `[@${mentionLabel(user.name)}](${userMentionHref(slug, user.id)})`;
}

/**
 * Matches the whole `[@label](href)` construct, so the href can be checked
 * against the mention shape rather than the body being scanned for bare ids.
 *
 * The label may not contain a `]`, which is exactly what `mentionLabel`
 * guarantees when the composer writes one.
 */
const MENTION_LINK = /\[@[^\]\n]*\]\(([^)\s]+)\)/g;

/**
 * Every workspace member a body names, de-duplicated, in the order they appear.
 *
 * Only ids come back. Whether they are still members — and whether they should
 * hear about it — is the caller's question, and the caller is the only one that
 * can answer it.
 */
export function findUserMentions(body: string, slug?: string): string[] {
	const found = new Set<string>();

	for (const match of body.matchAll(MENTION_LINK)) {
		const mention = parseUserMentionHref(match[1]!);
		if (mention === null) continue;
		if (slug !== undefined && mention.slug !== slug) continue;
		found.add(mention.userId);
	}

	return [...found];
}
