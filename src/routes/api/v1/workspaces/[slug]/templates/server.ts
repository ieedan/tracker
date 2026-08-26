import { nanoid } from "nanoid";
import * as v from "valibot";
import { CreateIssueTemplateBody, IssueTemplateSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { issueTemplate } from "@/lib/server/schema.server";
import { requireTeam } from "@/lib/server/teams.server";
import {
	listIssueTemplates,
	requireIssueTemplate,
	resolveTemplateAssignee,
	resolveTemplateRepository,
	setTemplateLabels,
} from "@/lib/server/templates.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(IssueTemplateSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		// Templates are workspace furniture, like labels and teams — anyone who
		// can read the workspace can open the composer on one.
		requirePermission(locals, "workspace", "read");
		return await listIssueTemplates(workspace.id);
	},
});

export const POST = handler({
	body: CreateIssueTemplateBody,
	response: IssueTemplateSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "write");

		// A key that names no team is a 404 here rather than a template that
		// silently pins nothing.
		const pinned =
			body.teamKey === null || body.teamKey === ""
				? null
				: await requireTeam(workspace.id, body.teamKey);

		const id = nanoid();
		const now = new Date();
		await db.insert(issueTemplate).values({
			id,
			workspaceId: workspace.id,
			name: body.name,
			summary: body.summary,
			title: body.title,
			description: body.description,
			teamId: pinned?.id ?? null,
			status: body.status,
			priority: body.priority,
			assigneeId: await resolveTemplateAssignee(workspace.id, body.assigneeId),
			repositoryId: await resolveTemplateRepository(workspace.id, body.repositoryId),
			createdBy: user.id,
			createdAt: now,
			updatedAt: now,
		});
		await setTemplateLabels(workspace.id, id, body.labelIds);

		return json(await requireIssueTemplate(workspace.id, id), { status: 201 });
	},
});
