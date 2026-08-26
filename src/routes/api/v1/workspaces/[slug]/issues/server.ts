import { error } from "@implementjs/kit/server";
import { nanoid } from "nanoid";
import * as v from "valibot";
import {
	CreateIssueBody,
	IssuePrioritySchema,
	IssueSchema,
	IssueStatusSchema,
} from "@/lib/domain/schemas";
import { creationActivity, recordActivity } from "@/lib/server/activity.server";
import { adoptDraftAttachments } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { emitIssueEvent } from "@/lib/server/events.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import {
	assertMember,
	getIssueById,
	insertWithNumber,
	listIssues,
	setIssueLabels,
	validLabelIds,
} from "@/lib/server/issues.server";
import { requireRepository } from "@/lib/server/repositories.server";
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
		/** A linked repository id. */
		repository: v.optional(v.string()),
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
			repositoryId: query.repository,
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
		// A repository from another workspace would scope this issue to something
		// its members cannot see, so the id is checked rather than trusted.
		if (body.repositoryId != null && body.repositoryId !== "") {
			await requireRepository(workspace.id, body.repositoryId);
		}

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
				repositoryId: body.repositoryId ?? null,
				creatorId: user.id,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		await setIssueLabels(id, labelIds);

		// Files uploaded in the composer have no parent yet; claim them now.
		await adoptDraftAttachments({
			ids: body.attachmentIds ?? [],
			issueId: id,
			workspaceId: workspace.id,
			userId: user.id,
		});

		await notify({
			userId: body.assigneeId,
			actorId: user.id,
			onBehalfOfId: locals.agent?.installedByUserId,
			workspaceId: workspace.id,
			issueId: id,
			type: "issue_assigned",
			body: `${user.name} assigned ${identifierFor(owningTeam.key, number)} to you`,
		});

		const created = await getIssueById(id);
		if (created === undefined) error(500, "issue vanished after insert");

		// Whatever the composer set is part of what happened here, so it lands on
		// the timeline now rather than waiting for an edit to reveal it.
		await recordActivity(id, user.id, creationActivity(created));

		await emitIssueEvent("issue.created", { workspace, actor: user, issue: created });
		return json(created, { status: 201 });
	},
});
