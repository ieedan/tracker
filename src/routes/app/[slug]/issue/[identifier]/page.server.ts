import { error } from "@implementjs/kit/server";
import { asc, eq } from "drizzle-orm";
import { parseIdentifier } from "@/lib/domain/issues";
import { attachmentsFor } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import { getIssueByIdentifier } from "@/lib/server/issues.server";
import { comment, user } from "@/lib/server/schema.server";
import { toComment } from "@/lib/server/serialize.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);

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

	const { byIssue, byComment } = await attachmentsFor(params.slug, {
		issueIds: [found.id],
		commentIds: commentRows.map((row) => row.comment.id),
	});

	return {
		issue: found,
		attachments: byIssue.get(found.id) ?? [],
		comments: commentRows.map((row) =>
			toComment(row.comment, row.author, byComment.get(row.comment.id) ?? []),
		),
	};
}
