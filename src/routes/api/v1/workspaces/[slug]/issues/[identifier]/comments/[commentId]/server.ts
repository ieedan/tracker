/**
 * One comment on an issue: edit it, or take it back.
 *
 * A comment belongs to whoever wrote it, so editing is the author's alone.
 * Deleting is the author's too, plus workspace admins — the same people who
 * can already remove members can clear out what should not have been said.
 */
import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { parseIdentifier } from "@/lib/domain/issues";
import { CommentSchema, UpdateCommentBody } from "@/lib/domain/schemas";
import { attachmentsFor } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { comment, issue, team, user } from "@/lib/server/schema.server";
import { toComment } from "@/lib/server/serialize.server";
import { handler } from "./$types";

const CommentParams = v.object({
	slug: v.string(),
	identifier: v.string(),
	commentId: v.string(),
});

/**
 * The comment behind the id, scoped through its issue to the workspace — a
 * comment id from another workspace 404s the same as one that never existed.
 */
async function findComment(
	workspaceId: string,
	identifier: string,
	commentId: string,
): Promise<{ comment: typeof comment.$inferSelect; author: typeof user.$inferSelect }> {
	const parsed = parseIdentifier(identifier);
	if (parsed === null) error(404, `"${identifier}" is not an issue identifier`);

	const rows = await db
		.select({ comment, author: user })
		.from(comment)
		.innerJoin(issue, eq(issue.id, comment.issueId))
		.innerJoin(team, eq(team.id, issue.teamId))
		.innerJoin(user, eq(user.id, comment.authorId))
		.where(
			and(
				eq(comment.id, commentId),
				eq(team.workspaceId, workspaceId),
				eq(team.key, parsed.key),
				eq(issue.number, parsed.number),
			),
		)
		.limit(1);

	const found = rows[0];
	if (found === undefined) error(404, "no such comment on this issue");
	return found;
}

export const PATCH = handler({
	params: CommentParams,
	body: UpdateCommentBody,
	response: CommentSchema,
	async handle({ locals, params, body }) {
		const { workspace, user: editor } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
		const found = await findComment(workspace.id, params.identifier, params.commentId);

		// The words are the author's; not even an admin gets to reword them.
		if (found.comment.authorId !== editor.id) {
			error(403, "only the author can edit a comment");
		}

		const updated = { ...found.comment, body: body.body, updatedAt: new Date() };
		await db
			.update(comment)
			.set({ body: updated.body, updatedAt: updated.updatedAt })
			.where(eq(comment.id, found.comment.id));

		const { byComment } = await attachmentsFor(params.slug, { commentIds: [found.comment.id] });
		return toComment(updated, found.author, byComment.get(found.comment.id) ?? []);
	},
});

export const DELETE = handler({
	params: CommentParams,
	async handle({ locals, params }) {
		const membership = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
		const found = await findComment(membership.workspace.id, params.identifier, params.commentId);

		if (found.comment.authorId !== membership.user.id && membership.role !== "admin") {
			error(403, "only the author or a workspace admin can delete a comment");
		}

		// Attachments hang off the row and cascade with it.
		await db.delete(comment).where(eq(comment.id, found.comment.id));
		// 204 — kit turns an undefined return into an empty response.
	},
});
