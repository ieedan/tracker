import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { feedbackIdentifier } from "@/lib/domain/feedback";
import { FeedbackSchema, UpdateFeedbackBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { emitFeedbackDeleted, emitFeedbackEvent } from "@/lib/server/events.server";
import {
	convertedIssue,
	findFeedbackRow,
	getFeedbackById,
	labelIdsFor,
	setFeedbackLabels,
} from "@/lib/server/feedback.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { assertMember, validLabelIds } from "@/lib/server/issues.server";
import { feedback } from "@/lib/server/schema.server";
import { handler } from "./$types";

const Params = v.object({ slug: v.string(), id: v.string() });

export const GET = handler({
	params: Params,
	response: FeedbackSchema,
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "feedback", "read");
		const row = await findFeedbackRow(workspace.id, params.id);
		if (row === undefined) error(404, "no such feedback");

		const found = await getFeedbackById(row.id);
		if (found === undefined) error(404, "no such feedback");
		return found;
	},
});

/**
 * Triage: status, priority, assignee, labels, visibility, and light edits to
 * the text — the same properties an issue is triaged by, because feedback is
 * the same thing seen earlier (ENG-77).
 *
 * A status move emits its own event as well as `feedback.updated`, because
 * "it moved to Planned" is the thing an integration actually wants to react to
 * and making it dig through a `changes` object for that is unkind.
 */
export const PATCH = handler({
	params: Params,
	body: UpdateFeedbackBody,
	response: FeedbackSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "feedback", "write");
		const before = await findFeedbackRow(workspace.id, params.id);
		if (before === undefined) error(404, "no such feedback");

		// Publishing into a board the workspace has not opened is refused rather
		// than silently downgraded: here there is a person to tell.
		if (body.visibility === "public" && workspace.feedbackBoard !== "public") {
			error(400, "turn on the public feedback board before making feedback public");
		}

		const changes: Record<string, { from: unknown; to: unknown }> = {};
		const patch: Partial<typeof feedback.$inferInsert> = {};

		if (body.title !== undefined && body.title !== before.title) {
			changes.title = { from: before.title, to: body.title };
			patch.title = body.title;
		}
		if (body.description !== undefined && body.description !== before.description) {
			changes.description = { from: before.description, to: body.description };
			patch.description = body.description;
		}
		// Once feedback has become an issue its status is the issue's, derived on
		// the way out. Accepting a write here would put a value in the column that
		// nothing ever reads and no screen ever shows — which is how a piece of
		// feedback ends up claiming to be New three weeks after it shipped
		// (ENG-77). Refused rather than ignored: there is a person to tell.
		if (body.status !== undefined) {
			const linked = await convertedIssue(before.id);
			if (linked !== null) {
				error(409, `${feedbackIdentifier(before.number)} follows ${linked.identifier} now`);
			}
			if (body.status !== before.status) {
				changes.status = { from: before.status, to: body.status };
				patch.status = body.status;
			}
		}
		if (body.priority !== undefined && body.priority !== before.priority) {
			changes.priority = { from: before.priority, to: body.priority };
			patch.priority = body.priority;
		}
		if (body.assigneeId !== undefined) {
			// The same check the issue endpoint makes: you cannot hand work to
			// somebody who is not in the workspace.
			if (body.assigneeId !== null && body.assigneeId !== "") {
				await assertMember(workspace.id, body.assigneeId);
			}
			const next = body.assigneeId === "" ? null : body.assigneeId;
			if (next !== before.assigneeId) {
				changes.assigneeId = { from: before.assigneeId, to: next };
				patch.assigneeId = next;
			}
		}
		if (body.visibility !== undefined && body.visibility !== before.visibility) {
			changes.visibility = { from: before.visibility, to: body.visibility };
			patch.visibility = body.visibility;
		}

		if (body.labelIds !== undefined) {
			const wanted = await validLabelIds(workspace.id, body.labelIds);
			const current = await labelIdsFor(before.id);
			if (wanted.toSorted().join() !== current.toSorted().join()) {
				changes.labelIds = { from: current, to: wanted };
				await setFeedbackLabels(before.id, wanted);
			}
		}

		if (Object.keys(patch).length > 0) {
			await db
				.update(feedback)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(feedback.id, before.id));
		}

		const after = await getFeedbackById(before.id);
		if (after === undefined) error(500, "feedback vanished after update");

		if (Object.keys(changes).length > 0) {
			await emitFeedbackEvent("feedback.updated", {
				workspace,
				actor: user,
				feedback: after,
				changes,
			});
			if (changes.status !== undefined) {
				await emitFeedbackEvent("feedback.status_changed", {
					workspace,
					actor: user,
					feedback: after,
					changes: { status: changes.status },
				});
			}
			// Same reasoning as the status event, and as `issue.assigned`: "it is
			// mine now" is what a receiver wants to key off.
			if (changes.assigneeId !== undefined) {
				await emitFeedbackEvent("feedback.assigned", {
					workspace,
					actor: user,
					feedback: after,
					changes: { assigneeId: changes.assigneeId },
				});
			}
		}

		return after;
	},
});

export const DELETE = handler({
	params: Params,
	response: v.object({ deleted: v.boolean() }),
	async handle({ locals, params }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "feedback", "write");
		const row = await findFeedbackRow(workspace.id, params.id);
		if (row === undefined) error(404, "no such feedback");

		await db.delete(feedback).where(eq(feedback.id, row.id));

		await emitFeedbackDeleted({
			workspace,
			actor: user,
			feedback: {
				id: row.id,
				number: row.number,
				identifier: feedbackIdentifier(row.number),
				title: row.title,
			},
		});

		return { deleted: true };
	},
});
