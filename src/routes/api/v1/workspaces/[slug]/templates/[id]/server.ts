import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { IssueTemplateSchema, UpdateIssueTemplateBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { issueTemplate } from "@/lib/server/schema.server";
import { requireTeam } from "@/lib/server/teams.server";
import {
	requireIssueTemplate,
	resolveTemplateAssignee,
	setTemplateLabels,
} from "@/lib/server/templates.server";
import { handler } from "./$types";

export const PATCH = handler({
	body: UpdateIssueTemplateBody,
	response: IssueTemplateSchema,
	async handle({ locals, params, body }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "write");

		// 404s a template in another workspace before anything is written.
		await requireIssueTemplate(workspace.id, params.id);

		const changes: Partial<typeof issueTemplate.$inferInsert> = { updatedAt: new Date() };
		if (body.name !== undefined) changes.name = body.name;
		if (body.summary !== undefined) changes.summary = body.summary;
		if (body.title !== undefined) changes.title = body.title;
		if (body.description !== undefined) changes.description = body.description;
		if (body.status !== undefined) changes.status = body.status;
		if (body.priority !== undefined) changes.priority = body.priority;
		if (body.teamKey !== undefined) {
			changes.teamId =
				body.teamKey === null || body.teamKey === ""
					? null
					: (await requireTeam(workspace.id, body.teamKey)).id;
		}
		if (body.assigneeId !== undefined) {
			changes.assigneeId = await resolveTemplateAssignee(workspace.id, body.assigneeId);
		}

		await db
			.update(issueTemplate)
			.set(changes)
			.where(and(eq(issueTemplate.workspaceId, workspace.id), eq(issueTemplate.id, params.id)));

		if (body.labelIds !== undefined) {
			await setTemplateLabels(workspace.id, params.id, body.labelIds);
		}

		return await requireIssueTemplate(workspace.id, params.id);
	},
});

export const DELETE = handler({
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "write");

		const deleted = await db
			.delete(issueTemplate)
			.where(and(eq(issueTemplate.workspaceId, workspace.id), eq(issueTemplate.id, params.id)))
			.returning({ id: issueTemplate.id });

		if (deleted.length === 0) error(404, "no such template");
	},
});
