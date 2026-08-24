import { db } from "@/lib/db.server";
import { issueLabels, issues } from "@/lib/db/schema";
import type { Issue } from "@/lib/db/types";
import { NewIssueSchema } from "@/lib/features/issues/create-issue-dialog";
import { handler } from "@implementjs/kit/server";
import * as v from "valibot";

export const POST = handler({
	body: NewIssueSchema,
	response: v.custom<Issue>(() => true),
	handle: async ({ body }) => {
		const issue = await db.transaction(async (tx) => {
			const newIssue = await tx
				.insert(issues)
				.values({
					teamId: body.teamId,
					title: body.title,
					body: body.body,
					status: body.status,
					priority: body.priority,
					assignee: body.assignee,
					assignedAt: body.assignee ? new Date() : undefined,
				})
				.returning()
				.get();

			if (body.labels.length > 0) {
				await tx
					.insert(issueLabels)
					.values(body.labels.map((labelId) => ({ issueId: newIssue.id, labelId })));
			}

			return await tx.query.issues.findFirst({
				where: { id: newIssue.id },
				with: { labels: true, team: true },
			});
		});

		if (!issue) throw new Error("There was an error getting the issue");

		return Response.json(issue satisfies Issue, { status: 201 });
	},
});

export const GET = handler({
	handle: async () => {
		const issues = await db.query.issues.findMany({
			with: { labels: true, team: true },
		});

		return issues;
	},
});
