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
import { requireMembership } from "@/lib/server/guards.server";
import {
	assertMember,
	getIssueById,
	listIssues,
	nextIssueNumber,
	setIssueLabels,
	validLabelIds,
} from "@/lib/server/issues.server";
import { notify } from "@/lib/server/notifications.server";
import { issue } from "@/lib/server/schema.server";
import { identifierFor } from "@/lib/server/serialize.server";
import { handler, json } from "./$types";

/** A query key may repeat (`?status=todo&status=done`), so accept either shape. */
const many = <T extends v.GenericSchema>(schema: T) =>
	v.optional(v.union([v.array(schema), schema]));

const asArray = <T>(value: T | T[] | undefined): T[] | undefined =>
	value === undefined ? undefined : Array.isArray(value) ? value : [value];

export const GET = handler({
	query: v.object({
		status: many(IssueStatusSchema),
		priority: many(IssuePrioritySchema),
		/** A user id, or `none` for issues nobody owns. */
		assignee: v.optional(v.string()),
		q: v.optional(v.string()),
	}),
	response: v.array(IssueSchema),
	async handle({ locals, params, query }) {
		const { workspace } = await requireMembership(locals, params.slug);
		return await listIssues(workspace.id, workspace.key, {
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

		if (body.assigneeId != null && body.assigneeId !== "") {
			await assertMember(workspace.id, body.assigneeId);
		}
		const labelIds = await validLabelIds(workspace.id, body.labelIds ?? []);

		const id = nanoid();
		const number = await insertWithNumber(workspace.id, async (candidate) => {
			await db.insert(issue).values({
				id,
				workspaceId: workspace.id,
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
			body: `${user.name} assigned ${identifierFor(workspace.key, number)} to you`,
		});

		const created = await getIssueById(id, workspace.key);
		if (created === undefined) error(500, "issue vanished after insert");
		return json(created, { status: 201 });
	},
});

/**
 * Issue numbers are per-workspace and allocated by reading the current maximum,
 * which two concurrent creates can read identically. The unique index on
 * (workspaceId, number) rejects the loser, so retry rather than serialize every
 * create behind a lock.
 */
async function insertWithNumber(
	workspaceId: string,
	insert: (candidate: number) => Promise<void>,
): Promise<number> {
	let lastFailure: unknown;
	for (let attempt = 0; attempt < 5; attempt++) {
		const candidate = await nextIssueNumber(workspaceId);
		try {
			await insert(candidate);
			return candidate;
		} catch (cause) {
			lastFailure = cause;
			const message = cause instanceof Error ? cause.message : String(cause);
			// Anything that is not the number collision is the caller's problem.
			if (!message.includes("UNIQUE") && !message.includes("constraint")) throw cause;
		}
	}
	throw lastFailure;
}
