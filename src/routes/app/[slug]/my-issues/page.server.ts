import { requireMembership } from "@/lib/server/guards.server";
import {
	listAssignedIssues,
	listCreatedIssues,
	listSubscribedIssues,
} from "@/lib/server/issues.server";
import type { LoadEvent } from "./$types";

/**
 * All three slices, not just the open tab.
 *
 * The tab rides in the query string, and a kit navigation that only changes the
 * search does not re-run the load — so a server-sliced page would keep showing
 * the tab you left. Loading the three of them also makes the counts on the tabs
 * free, and one member's work in one workspace is a small enough list that
 * fetching all of it beats a round trip per click.
 */
export default async function load({ locals, params }: LoadEvent) {
	const { workspace, user } = await requireMembership(locals, params.slug);

	const [assigned, created, subscribed] = await Promise.all([
		listAssignedIssues(workspace.id, user.id),
		listCreatedIssues(workspace.id, user.id),
		listSubscribedIssues(workspace.id, user.id),
	]);

	return { assigned, created, subscribed };
}
