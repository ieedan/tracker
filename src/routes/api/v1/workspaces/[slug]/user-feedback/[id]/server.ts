import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { feedbackIdentifier } from "@/lib/domain/feedback";
import { FeedbackSchema, UpdateFeedbackBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { emitFeedbackDeleted, emitFeedbackEvent } from "@/lib/server/events.server";
import {
	findFeedbackRow,
	getFeedbackById,
	labelIdsFor,
	setFeedbackLabels,
} from "@/lib/server/feedback.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { validLabelIds } from "@/lib/server/issues.server";
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
 * Triage: status, labels, visibility, and light edits to the text.
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
		if (body.status !== undefined && body.status !== before.status) {
			changes.status = { from: before.status, to: body.status };
			patch.status = body.status;
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
