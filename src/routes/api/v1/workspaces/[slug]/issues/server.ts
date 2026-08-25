import { error } from "@implementjs/kit/server";
import { nanoid } from "nanoid";
import * as v from "valibot";
import {
	CreateIssueBody,
	IssuePrioritySchema,
	IssueSchema,
	IssueStatusSchema,
} from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import {
	assertMember,
	getIssueById,
	insertWithNumber,
	listIssues,
	setIssueLabels,
	validLabelIds,
} from "@/lib/server/issues.server";
import { emitIssueEvent } from "@/lib/server/events.server";
import { notify } from "@/lib/server/notifications.server";
import { issue } from "@/lib/server/schema.server";
import { identifierFor } from "@/lib/server/serialize.server";
import { requireTeam } from "@/lib/server/teams.server";
import { handler, json } from "./$types";

/** A query key may repeat (`?status=todo&status=done`), so accept either shape. */
const many = <T extends v.GenericSchema>(schema: T) =>
	v.optional(v.union([v.array(schema), schema]));

const asArray = <T>(value: T | T[] | undefined): T[] | undefined =>
	value === undefined ? undefined : Array.isArray(value) ? value : [value];

/** Every issue in the workspace, across teams unless `team` narrows it. */
export const GET = handler({
	query: v.object({
		/** A team key, `ENG`. Omit for every team in the workspace. */
		team: v.optional(v.pipe(v.string(), v.toUpperCase())),
		status: many(IssueStatusSchema),
		priority: many(IssuePrioritySchema),
		/** A user id, or `none` for issues nobody owns. */
		assignee: v.optional(v.string()),
		q: v.optional(v.string()),
	}),
	response: v.array(IssueSchema),
	async handle({ locals, params, query }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "read");

		// A key that names no team is a 404 rather than an empty list — otherwise
		// a typo looks like a team with no work in it.
		if (query.team !== undefined) await requireTeam(workspace.id, query.team);

		return await listIssues(workspace.id, {
			teamKey: query.team,
			status: asArray(query.status),
			priority: asArray(query.priority),
			assigneeId: query.assignee === "none" ? undefined : query.assignee,
			unassigned: query.assignee === "none",
			search: query.q,
		});
	},
});

export const POST = handler({
	body: CreateIssueBody,
	response: IssueSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
		const owningTeam = await requireTeam(workspace.id, body.teamKey);

		if (body.assigneeId != null && body.assigneeId !== "") {
			await assertMember(workspace.id, body.assigneeId);
		}
		const labelIds = await validLabelIds(workspace.id, body.labelIds ?? []);

		const id = nanoid();
		const number = await insertWithNumber(owningTeam.id, async (candidate) => {
			await db.insert(issue).values({
				id,
				teamId: owningTeam.id,
				number: candidate,
				title: body.title,
				description: body.description,
				status: body.status,
				priority: body.priority,
				assigneeId: body.assigneeId ?? null,
				creatorId: user.id,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		await setIssueLabels(id, labelIds);

		await notify({
			userId: body.assigneeId,
			actorId: user.id,
			workspaceId: workspace.id,
			issueId: id,
			type: "issue_assigned",
			body: `${user.name} assigned ${identifierFor(owningTeam.key, number)} to you`,
		});

		const created = await getIssueById(id);
		if (created === undefined) error(500, "issue vanished after insert");

		await emitIssueEvent("issue.created", { workspace, actor: user, issue: created });
		return json(created, { status: 201 });
	},
});
