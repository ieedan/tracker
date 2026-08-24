import { error } from "@implementjs/kit/server";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { parseIdentifier } from "@/lib/domain/issues";
import { CommentSchema, CreateCommentBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import { emitCommentEvent } from "@/lib/server/events.server";
import { getIssueById } from "@/lib/server/issues.server";
import { notify } from "@/lib/server/notifications.server";
import { comment, issue, team, user } from "@/lib/server/schema.server";
import { identifierFor, toComment } from "@/lib/server/serialize.server";
import { handler, json } from "./$types";

const IdentifierParams = v.object({
	slug: v.string(),
	identifier: v.string(),
});

/** The issue behind `ENG-42`, scoped to the workspace, or a 404. */
async function findIssue(
	workspaceId: string,
	identifier: string,
): Promise<{ issue: typeof issue.$inferSelect; team: typeof team.$inferSelect }> {
	const parsed = parseIdentifier(identifier);
	if (parsed === null) error(404, `"${identifier}" is not an issue identifier`);

	const rows = await db
		.select({ issue, team })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(
			and(
				eq(team.workspaceId, workspaceId),
				eq(team.key, parsed.key),
				eq(issue.number, parsed.number),
			),
		)
		.limit(1);

	const found = rows[0];
	if (found === undefined) error(404, `no issue ${parsed.key}-${parsed.number}`);
	return found;
}

export const GET = handler({
	params: IdentifierParams,
	response: v.array(CommentSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		const target = await findIssue(workspace.id, params.identifier);

		const rows = await db
			.select({ comment, author: user })
			.from(comment)
			.innerJoin(user, eq(user.id, comment.authorId))
			.where(eq(comment.issueId, target.issue.id))
			.orderBy(asc(comment.createdAt));

		return rows.map((row) => toComment(row.comment, row.author));
	},
});

export const POST = handler({
	params: IdentifierParams,
	body: CreateCommentBody,
	response: CommentSchema,
	async handle({ locals, params, body }) {
		const { workspace, user: author } = await requireMembership(locals, params.slug);
		const target = await findIssue(workspace.id, params.identifier);

		const row = {
			id: nanoid(),
			issueId: target.issue.id,
			authorId: author.id,
			body: body.body,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		await db.insert(comment).values(row);

		const identifier = identifierFor(target.team.key, target.issue.number);
		const audience = new Set(
			[target.issue.assigneeId, target.issue.creatorId].filter(
				(id): id is string => id != null && id !== "",
			),
		);
		for (const userId of audience) {
			await notify({
				userId,
				actorId: author.id,
				workspaceId: workspace.id,
				issueId: target.issue.id,
				type: "issue_commented",
				body: `${author.name} commented on ${identifier}`,
			});
		}

		const full = await getIssueById(target.issue.id);
		if (full !== undefined) {
			await emitCommentEvent({
				workspace,
				actor: author,
				issue: full,
				comment: { id: row.id, body: row.body, createdAt: row.createdAt.toISOString() },
			});
		}

		return json(toComment(row, author), { status: 201 });
	},
});
