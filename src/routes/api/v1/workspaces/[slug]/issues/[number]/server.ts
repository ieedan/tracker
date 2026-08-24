import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { STATUS_LABELS } from "@/lib/domain/issues";
import { IssueSchema, UpdateIssueBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import {
	assertMember,
	getIssueByNumber,
	setIssueLabels,
	validLabelIds,
} from "@/lib/server/issues.server";
import { notify } from "@/lib/server/notifications.server";
import { issue } from "@/lib/server/schema.server";
import { handler } from "./$types";

export const GET = handler({
	// implement:bug:#1: a `[number=integer]` matcher directory leaks its matcher
	// name into the generated OpenAPI path (`{number=integer}`) while the
	// parameter object is still named `number`, so the document is invalid for
	// this route. Parsing in the handler instead keeps the path template clean.
	// A `params` schema replaces every param, not just the one it names, so
	// `slug` has to be redeclared here even though only `number` is parsed.
	params: v.object({
		slug: v.string(),
		number: v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
	}),
	response: IssueSchema,
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		const found = await getIssueByNumber(workspace.id, workspace.key, params.number);
		if (found === undefined) error(404, `no issue ${workspace.key}-${params.number}`);
		return found;
	},
});

export const PATCH = handler({
	// implement:bug:#1: a `[number=integer]` matcher directory leaks its matcher
	// name into the generated OpenAPI path (`{number=integer}`) while the
	// parameter object is still named `number`, so the document is invalid for
	// this route. Parsing in the handler instead keeps the path template clean.
	// A `params` schema replaces every param, not just the one it names, so
	// `slug` has to be redeclared here even though only `number` is parsed.
	params: v.object({
		slug: v.string(),
		number: v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
	}),
	body: UpdateIssueBody,
	response: IssueSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);

		const rows = await db
			.select()
			.from(issue)
			.where(and(eq(issue.workspaceId, workspace.id), eq(issue.number, params.number)))
			.limit(1);
		const before = rows[0];
		if (before === undefined) error(404, `no issue ${workspace.key}-${params.number}`);

		if (body.assigneeId != null && body.assigneeId !== "") {
			await assertMember(workspace.id, body.assigneeId);
		}

		const changes: Partial<typeof issue.$inferInsert> = { updatedAt: new Date() };
		if (body.title !== undefined) changes.title = body.title;
		if (body.description !== undefined) changes.description = body.description;
		if (body.status !== undefined) changes.status = body.status;
		if (body.priority !== undefined) changes.priority = body.priority;
		if (body.assigneeId !== undefined) changes.assigneeId = body.assigneeId;

		await db.update(issue).set(changes).where(eq(issue.id, before.id));

		if (body.labelIds !== undefined) {
			await setIssueLabels(before.id, await validLabelIds(workspace.id, body.labelIds));
		}

		const identifier = `${workspace.key}-${before.number}`;

		// Reassignment tells the new owner, and tells the previous one they are off it.
		if (body.assigneeId !== undefined && body.assigneeId !== before.assigneeId) {
			await notify({
				userId: body.assigneeId,
				actorId: user.id,
				workspaceId: workspace.id,
				issueId: before.id,
				type: "issue_assigned",
				body: `${user.name} assigned ${identifier} to you`,
			});
			await notify({
				userId: before.assigneeId,
				actorId: user.id,
				workspaceId: workspace.id,
				issueId: before.id,
				type: "issue_unassigned",
				body: `${user.name} unassigned you from ${identifier}`,
			});
		}

		// A status change is interesting to whoever owns the issue and whoever filed it.
		if (body.status !== undefined && body.status !== before.status) {
			const message = `${user.name} moved ${identifier} to ${STATUS_LABELS[body.status]}`;
			const audience = new Set(
				[before.assigneeId, body.assigneeId, before.creatorId].filter(
					(id): id is string => id != null && id !== "",
				),
			);
			for (const userId of audience) {
				await notify({
					userId,
					actorId: user.id,
					workspaceId: workspace.id,
					issueId: before.id,
					type: "issue_status_changed",
					body: message,
				});
			}
		}

		const updated = await getIssueByNumber(workspace.id, workspace.key, params.number);
		if (updated === undefined) error(500, "issue vanished after update");
		return updated;
	},
});

export const DELETE = handler({
	// implement:bug:#1: a `[number=integer]` matcher directory leaks its matcher
	// name into the generated OpenAPI path (`{number=integer}`) while the
	// parameter object is still named `number`, so the document is invalid for
	// this route. Parsing in the handler instead keeps the path template clean.
	// A `params` schema replaces every param, not just the one it names, so
	// `slug` has to be redeclared here even though only `number` is parsed.
	params: v.object({
		slug: v.string(),
		number: v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1)),
	}),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		const deleted = await db
			.delete(issue)
			.where(and(eq(issue.workspaceId, workspace.id), eq(issue.number, params.number)))
			.returning({ id: issue.id });
		if (deleted.length === 0) error(404, `no issue ${workspace.key}-${params.number}`);
		// 204 — kit turns an undefined return into an empty response.
	},
});
