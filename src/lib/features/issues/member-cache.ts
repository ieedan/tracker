/**
 * Workspace members, remembered per workspace for as long as the tab lives.
 *
 * The `@` menu has to answer the keystroke that opened it. A file search is a
 * request because the file index is thousands of paths and lives on the server;
 * a member list is a handful of rows that changes about once a month, so paying
 * a round trip per keystroke to rank six names would be slower than the typing
 * and would still be ranking the same six names.
 *
 * Same bargain as `team-cache.ts`: nothing here is the source of truth. The
 * layout already loads the members for every screen under a workspace and seeds
 * this with them; this only decides who the menu can offer before a fetch of
 * its own has landed.
 */
import { api } from "@/lib/client/api";
import type { Member } from "@/lib/domain/schemas";

const cache = new Map<string, Member[]>();
/** One request per workspace, however many callers ask for it at once. */
const inFlight = new Map<string, Promise<Member[]>>();

/** Who is already known to be in a workspace; empty when nobody is. */
export function cachedMembers(slug: string): Member[] {
	return cache.get(slug) ?? [];
}

/** Remember what a load turned up — or what the layout already had. */
export function cacheMembers(slug: string, members: Member[]): void {
	cache.set(slug, members);
}

/**
 * Fetch a workspace's members unless they are already known, or already on the
 * way. A failure is swallowed rather than reported: an `@` menu that offers no
 * people is a menu that offers files, which is what it did before.
 */
export async function warmMembers(slug: string): Promise<Member[]> {
	const known = cache.get(slug);
	if (known !== undefined) return known;

	const pending = inFlight.get(slug);
	if (pending !== undefined) return await pending;

	const request = api
		.GET("/api/v1/workspaces/[slug]/members", { params: { slug } })
		.then(({ data, error }) => {
			if (error !== undefined) return [];
			cache.set(slug, data);
			return data;
		})
		.catch(() => [])
		.finally(() => inFlight.delete(slug));

	inFlight.set(slug, request);
	return await request;
}
