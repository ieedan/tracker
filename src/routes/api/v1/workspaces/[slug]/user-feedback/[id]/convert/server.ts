import { error } from "@implementjs/kit/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { preferDefaultTeam } from "@/lib/domain/issues";
import { ConvertFeedbackBody, IssueSchema } from "@/lib/domain/schemas";
import { creationActivity, recordActivity } from "@/lib/server/activity.server";
import { db } from "@/lib/server/db.server";
import { emitFeedbackEvent, emitIssueEvent } from "@/lib/server/events.server";
import {
	convertedIssue,
	feedbackLabelId,
	findFeedbackRow,
	getFeedbackById,
	labelIdsFor,
} from "@/lib/server/feedback.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import {
	assertMember,
	getIssueById,
	insertWithNumber,
	setIssueLabels,
	subscribeToIssue,
} from "@/lib/server/issues.server";
import { feedback, issue, team } from "@/lib/server/schema.server";
import { requireTeam } from "@/lib/server/teams.server";
import { handler, json } from "./$types";

/**
 * Turns a piece of feedback into an issue — the one click the feedback tab is
 * built around.
 *
 * Two things make the link worth having in both directions. The issue keeps
 * `feedbackId`, so months later you can see what someone actually asked for
 * rather than the rewritten version; and the feedback keeps its converted
 * issue, so the person who submitted it can be told what happened.
 *
 * Converting twice is not an error and does not make a second issue. The unique
 * index on `issue.feedbackId` guarantees that, but checking first means the
 * second caller gets the existing issue back rather than a constraint failure.
 */
export const POST = handler({
	params: v.object({ slug: v.string(), id: v.string() }),
	body: ConvertFeedbackBody,
	response: IssueSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "feedback", "write");
		requirePermission(locals, "issues", "write");

		const row = await findFeedbackRow(workspace.id, params.id);
		if (row === undefined) error(404, "no such feedback");

		const already = await convertedIssue(row.id);
		if (already !== null) {
			const existing = await getIssueById(already.id);
			if (existing === undefined) error(500, "converted issue vanished");
			return json(existing, { status: 200 });
		}

		const owningTeam =
			body.teamKey === undefined
				? await defaultTeam(workspace.id)
				: await requireTeam(workspace.id, body.teamKey);

		if (body.assigneeId != null && body.assigneeId !== "") {
			await assertMember(workspace.id, body.assigneeId);
		}

		const issueId = nanoid();
		await insertWithNumber(owningTeam.id, async (candidate) => {
			await db.insert(issue).values({
				id: issueId,
				teamId: owningTeam.id,
				number: candidate,
				title: body.title ?? row.title,
				// The submitter's own words, verbatim. Rewriting them here would
				// throw away the only record of what was actually asked for.
				description: row.description,
				status: "backlog",
				priority: body.priority,
				assigneeId: body.assigneeId ?? null,
				creatorId: user.id,
				feedbackId: row.id,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		// The feedback's own labels carry over, plus the marker that says where
		// this came from.
		const carried = await labelIdsFor(row.id);
		const marker = await feedbackLabelId(workspace.id);
		await setIssueLabels(issueId, [...new Set([...carried, marker])]);

		// Converting files the issue on the converter's behalf, so they — and an
		// assignee named on the form — follow it from the start.
		await subscribeToIssue(issueId, user.id);
		await subscribeToIssue(issueId, body.assigneeId);
		// An agent converting on someone's behalf follows for them too.
		await subscribeToIssue(issueId, locals.agent?.installedByUserId);

		await db
			.update(feedback)
			.set({ status: body.status, updatedAt: new Date() })
			.where(eq(feedback.id, row.id));

		const created = await getIssueById(issueId);
		if (created === undefined) error(500, "issue vanished after insert");

		// A conversion carries the feedback's labels and whatever the form set, so
		// the new issue's timeline starts out saying so.
		await recordActivity(issueId, user.id, creationActivity(created));

		const after = await getFeedbackById(row.id);
		if (after !== undefined) {
			await emitFeedbackEvent("feedback.converted", {
				workspace,
				actor: user,
				feedback: after,
				issue: created,
			});
		}
		await emitIssueEvent("issue.created", { workspace, actor: user, issue: created });

		return json(created, { status: 201 });
	},
});

/** The team a conversion lands in when the caller does not name one. */
async function defaultTeam(workspaceId: string): Promise<typeof team.$inferSelect> {
	const rows = await db
		.select()
		.from(team)
		.where(eq(team.workspaceId, workspaceId))
		.orderBy(asc(team.createdAt));

	const found = preferDefaultTeam(rows);
	if (found === undefined) error(400, "this workspace has no teams to file an issue in");
	return found;
}
