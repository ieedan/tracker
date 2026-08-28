import { error } from "@implementjs/kit/server";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { parseIdentifier } from "@/lib/domain/issues";
import { CommentSchema, CreateCommentBody } from "@/lib/domain/schemas";
import { adoptDraftAttachments, attachmentsFor } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { emitCommentEvent } from "@/lib/server/events.server";
import { getIssueById, subscribeToIssue } from "@/lib/server/issues.server";
import { issueAudience, notify, notifyMentions } from "@/lib/server/notifications.server";
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
		requirePermission(locals, "issues", "read");
		const target = await findIssue(workspace.id, params.identifier);

		const rows = await db
			.select({ comment, author: user })
			.from(comment)
			.innerJoin(user, eq(user.id, comment.authorId))
			.where(eq(comment.issueId, target.issue.id))
			.orderBy(asc(comment.createdAt));

		const { byComment } = await attachmentsFor(params.slug, {
			commentIds: rows.map((row) => row.comment.id),
		});
		return rows.map((row) =>
			toComment(row.comment, row.author, byComment.get(row.comment.id) ?? []),
		);
	},
});

export const POST = handler({
	params: IdentifierParams,
	body: CreateCommentBody,
	response: CommentSchema,
	async handle({ locals, params, body }) {
		const { workspace, user: author } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
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

		// Files uploaded while the comment was being drafted have no parent yet;
		// claim them now that there is one.
		await adoptDraftAttachments({
			ids: body.attachmentIds ?? [],
			commentId: row.id,
			workspaceId: workspace.id,
			userId: author.id,
		});

		// Having said something on an issue is what "following" means by default,
		// so commenting subscribes you without asking. Idempotent, so the tenth
		// comment costs the same as the first, and the Subscribe control on the
		// issue is how you back out again.
		await subscribeToIssue(target.issue.id, author.id);
		// An agent commenting on someone's behalf follows for them too.
		await subscribeToIssue(target.issue.id, locals.agent?.installedByUserId);

		const identifier = identifierFor(target.team.key, target.issue.number);

		// Whoever the comment names hears that it named them, which is the more
		// specific version of the same news — so they are taken out of the
		// broadcast rather than getting both for one comment. Read before, because
		// being mentioned subscribes you and would otherwise widen the audience
		// this same loop is about to address.
		const audience = await issueAudience(target.issue.id);
		const mentioned = new Set(
			await notifyMentions({
				body: row.body,
				slug: params.slug,
				workspaceId: workspace.id,
				issueId: target.issue.id,
				identifier,
				actor: author,
			}),
		);

		for (const userId of audience) {
			if (mentioned.has(userId)) continue;
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

		const { byComment } = await attachmentsFor(params.slug, { commentIds: [row.id] });
		return json(toComment(row, author, byComment.get(row.id) ?? []), { status: 201 });
	},
});
