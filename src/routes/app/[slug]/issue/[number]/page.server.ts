import { error } from "@implementjs/kit/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import { getIssueByNumber } from "@/lib/server/issues.server";
import { comment, issue, user } from "@/lib/server/schema.server";
import { toComment } from "@/lib/server/serialize.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);

	const number = Number(params.number);
	if (!Number.isSafeInteger(number) || number < 1) error(404, "no such issue");

	const found = await getIssueByNumber(workspace.id, workspace.key, number);
	if (found === undefined) error(404, `no issue ${workspace.key}-${number}`);

	const commentRows = await db
		.select({ comment, author: user })
		.from(comment)
		.innerJoin(user, eq(user.id, comment.authorId))
		.innerJoin(issue, eq(issue.id, comment.issueId))
		.where(eq(comment.issueId, found.id))
		.orderBy(asc(comment.createdAt));

	return {
		issue: found,
		comments: commentRows.map((row) => toComment(row.comment, row.author)),
	};
}
