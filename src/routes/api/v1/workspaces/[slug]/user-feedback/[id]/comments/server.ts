import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { FEEDBACK_RATE_LIMITS } from "@/lib/domain/feedback";
import { CreateFeedbackCommentBody, FeedbackCommentSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { emitFeedbackEvent } from "@/lib/server/events.server";
import { getFeedbackById, listFeedbackComments, touchFeedback } from "@/lib/server/feedback.server";
import { requirePermission, requireUser } from "@/lib/server/guards.server";
import { consume } from "@/lib/server/rate-limit.server";
import {
	feedback,
	feedbackComment,
	user as userTable,
	workspace as workspaceTable,
	workspaceMember,
} from "@/lib/server/schema.server";
import { toFeedbackComment } from "@/lib/server/serialize.server";
import { handler, json } from "./$types";

const Params = v.object({ slug: v.string(), id: v.string() });

/**
 * Resolves the feedback and how much of it this caller may see.
 *
 * Deliberately not `requireMembership`: replies are the one part of feedback a
 * non-member takes part in. Anyone signed in may read and reply to *public*
 * feedback on a workspace with an open board — that account is the anti-spam
 * measure. Members see everything, including internal notes.
 */
async function resolve(locals: App.Locals, slug: string, feedbackId: string) {
	const user = requireUser(locals);

	const rows = await db
		.select({ feedback, workspace: workspaceTable })
		.from(feedback)
		.innerJoin(workspaceTable, eq(workspaceTable.id, feedback.workspaceId))
		.where(and(eq(feedback.id, feedbackId), eq(workspaceTable.slug, slug)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, "no such feedback");

	const memberRows = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(
			and(eq(workspaceMember.workspaceId, row.workspace.id), eq(workspaceMember.userId, user.id)),
		)
		.limit(1);

	const isMember = memberRows.length > 0;
	const readable =
		isMember || (row.feedback.visibility === "public" && row.workspace.feedbackBoard === "public");
	if (!readable) error(404, "no such feedback");

	return { user, feedback: row.feedback, workspace: row.workspace, isMember };
}

export const GET = handler({
	params: Params,
	response: v.array(FeedbackCommentSchema),
	async handle({ locals, params }) {
		const context = await resolve(locals, params.slug, params.id);
		requirePermission(locals, "feedback", "read");
		return await listFeedbackComments(context.feedback.id, context.isMember ? "member" : "public");
	},
});

export const POST = handler({
	params: Params,
	body: CreateFeedbackCommentBody,
	response: FeedbackCommentSchema,
	async handle({ locals, params, body }) {
		const context = await resolve(locals, params.slug, params.id);
		requirePermission(locals, "feedback", "write");

		// An internal note from someone outside the workspace is refused, not
		// quietly turned into a public reply — the two have very different
		// audiences and guessing wrong is the expensive direction.
		if (body.internal && !context.isMember) {
			error(403, "only workspace members can leave internal notes");
		}

		// Members are trusted; everyone else is rate limited per account, which is
		// what stops a signed-up throwaway from filling a public board.
		if (!context.isMember) {
			const budget = FEEDBACK_RATE_LIMITS.comment;
			const limit = await consume({
				key: `feedback-comment:${context.user.id}`,
				limit: budget.limit,
				windowMs: budget.windowMs,
			});
			if (!limit.allowed) error(429, `too many replies — try again in ${limit.retryAfter}s`);
		}

		const row = {
			id: nanoid(),
			feedbackId: context.feedback.id,
			authorId: context.user.id,
			body: body.body,
			internal: body.internal,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		await db.insert(feedbackComment).values(row);
		await touchFeedback(context.feedback.id);

		const authors = await db
			.select()
			.from(userTable)
			.where(eq(userTable.id, context.user.id))
			.limit(1);
		const author = authors[0] ?? { ...context.user, image: context.user.image };
		// Same redaction as the GET, so a reply looks the same whether it arrives
		// from the POST or the next page load.
		const created = toFeedbackComment(row, author, context.isMember ? "member" : "public");

		const full = await getFeedbackById(context.feedback.id);
		if (full !== undefined) {
			await emitFeedbackEvent("feedback.comment_created", {
				workspace: context.workspace,
				actor: context.user,
				feedback: full,
				comment: created,
			});
		}

		return json(created, { status: 201 });
	},
});
