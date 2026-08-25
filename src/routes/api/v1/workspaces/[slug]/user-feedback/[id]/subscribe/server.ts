import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { FEEDBACK_RATE_LIMITS } from "@/lib/domain/feedback";
import { SubscribeFeedbackBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { subscribeToFeedback } from "@/lib/server/feedback.server";
import { requirePermission } from "@/lib/server/guards.server";
import { clientAddress, consume } from "@/lib/server/rate-limit.server";
import { feedback, workspace as workspaceTable, workspaceMember } from "@/lib/server/schema.server";
import { handler } from "./$types";

/**
 * Adds an address to the list told when this feedback moves.
 *
 * Open to anyone on public feedback — the whole point of a public board is that
 * the person who asked can follow it without an account. It is rate limited by
 * IP for the same reason, and idempotent, so the worst a repeat submission does
 * is nothing.
 *
 * Nothing is sent yet. This collects the list so that when sending exists, it
 * is not starting from empty.
 */
export const POST = handler({
	params: v.object({ slug: v.string(), id: v.string() }),
	body: SubscribeFeedbackBody,
	response: v.object({ subscribed: v.boolean() }),
	async handle({ locals, params, body, request }) {
		const rows = await db
			.select({ feedback, workspace: workspaceTable })
			.from(feedback)
			.innerJoin(workspaceTable, eq(workspaceTable.id, feedback.workspaceId))
			.where(and(eq(feedback.id, params.id), eq(workspaceTable.slug, params.slug)))
			.limit(1);

		const row = rows[0];
		if (row === undefined) error(404, "no such feedback");

		const isMember = await memberOf(row.workspace.id, locals.user?.id ?? null);
		const openToPublic =
			row.feedback.visibility === "public" && row.workspace.feedbackBoard === "public";
		if (!isMember && !openToPublic) error(404, "no such feedback");
		// Members using a key still need the scope. Anonymous public-board
		// subscribe is the point of this route, so it stays unscoped.
		if (isMember) requirePermission(locals, "feedback", "write");

		if (!isMember) {
			const budget = FEEDBACK_RATE_LIMITS.public;
			const limit = await consume({
				key: `feedback-subscribe:${row.workspace.id}:${clientAddress(request)}`,
				limit: budget.limit,
				windowMs: budget.windowMs,
			});
			if (!limit.allowed) error(429, `too many requests — try again in ${limit.retryAfter}s`);
		}

		await subscribeToFeedback({
			feedbackId: row.feedback.id,
			email: body.email,
			userId: locals.authVia === "session" ? (locals.user?.id ?? null) : null,
		});

		return { subscribed: true };
	},
});

async function memberOf(workspaceId: string, userId: string | null): Promise<boolean> {
	if (userId === null) return false;
	const rows = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
		.limit(1);
	return rows.length > 0;
}
