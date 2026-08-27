/**
 * Teams, remembered per workspace for as long as the tab lives (ENG-71).
 *
 * The composer's breadcrumb files an issue into any workspace you belong to,
 * and the team is what gives that issue its identifier — so a switch that
 * blanks the team pill until a fetch lands is not a composer missing a crumb,
 * it is a composer whose Create button is disabled for the length of a round
 * trip. Teams are a short list that changes rarely, which makes them worth
 * holding onto: a switch back is instant, and so is a first switch to a
 * workspace whose teams were warmed when the crumb menu opened.
 *
 * Nothing here is the source of truth — every caller still runs its own load
 * and reconciles against the response. This only decides what is on screen
 * while that is in flight.
 */
import { api } from "@/lib/client/api";
import type { Team } from "@/lib/domain/schemas";

const cache = new Map<string, Team[]>();
/** One request per workspace, however many callers ask for it at once. */
const inFlight = new Map<string, Promise<Team[]>>();

/** What is already known about a workspace's teams; empty when nothing is. */
export function cachedTeams(slug: string): Team[] {
	return cache.get(slug) ?? [];
}

/** Remember what a load turned up — or what the shell already had. */
export function cacheTeams(slug: string, teams: Team[]): void {
	cache.set(slug, teams);
}

/**
 * Fetch a workspace's teams unless they are already known, or already on the
 * way. A failure is swallowed rather than reported: this is a head start, and
 * whoever needs the teams for real still has their own load to fall back on.
 */
export async function warmTeams(slug: string): Promise<Team[]> {
	const known = cache.get(slug);
	if (known !== undefined) return known;

	const pending = inFlight.get(slug);
	if (pending !== undefined) return await pending;

	const request = api
		.GET("/api/v1/workspaces/[slug]/teams", { params: { slug } })
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
