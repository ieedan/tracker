import { error } from "@implementjs/kit/server";
import { asc, eq } from "drizzle-orm";
import { parseIdentifier } from "@/lib/domain/issues";
import { listActivity } from "@/lib/server/activity.server";
import { attachmentsFor } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import { getIssueByIdentifier, isSubscribedToIssue } from "@/lib/server/issues.server";
import { listRepositories, pullRequestForIssue } from "@/lib/server/repositories.server";
import { comment, user } from "@/lib/server/schema.server";
import { toComment } from "@/lib/server/serialize.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace, user: viewer } = await requireMembership(locals, params.slug);

	const parsed = parseIdentifier(params.identifier);
	if (parsed === null) error(404, `"${params.identifier}" is not an issue identifier`);

	const found = await getIssueByIdentifier(workspace.id, parsed.key, parsed.number);
	if (found === undefined) error(404, `no issue ${parsed.key}-${parsed.number}`);

	const commentRows = await db
		.select({ comment, author: user })
		.from(comment)
		.innerJoin(user, eq(user.id, comment.authorId))
		.where(eq(comment.issueId, found.id))
		.orderBy(asc(comment.createdAt));

	// The issue's own attachments come back on the issue; only the comments'
	// still have to be looked up.
	const { byComment } = await attachmentsFor(params.slug, {
		commentIds: commentRows.map((row) => row.comment.id),
	});

	// Refreshed here rather than on every list render: this is the one screen
	// with exactly one pull request to check.
	const pull = await pullRequestForIssue(found.id);

	return {
		issue: {
			...found,
			pullRequest:
				pull === null
					? null
					: {
							id: pull.id,
							number: pull.number,
							title: pull.title,
							state: pull.state,
							url: pull.url,
						},
		},
		// The rail's repository picker needs the whole list, not just the one
		// this issue points at.
		repositories: await listRepositories(workspace.id),
		attachments: found.attachments,
		comments: commentRows.map((row) =>
			toComment(row.comment, row.author, byComment.get(row.comment.id) ?? []),
		),
		// The other half of the timeline. The client interleaves it with the
		// comments by timestamp rather than the server flattening them, because
		// only one of the two can be posted from the page.
		activity: await listActivity(found.id),
		// Whether the Subscribe control in the rail starts on. Loaded here rather
		// than fetched by the control, so the server render already has it right
		// and the button does not flip state a moment after the page appears.
		subscribed: await isSubscribedToIssue(found.id, viewer.id),
	};
}
