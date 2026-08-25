import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { parseIdentifier, STATUS_LABELS } from "@/lib/domain/issues";
import { IssueSchema, UpdateIssueBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import {
	assertMember,
	getIssueById,
	getIssueByIdentifier,
	insertWithNumber,
	setIssueLabels,
	validLabelIds,
} from "@/lib/server/issues.server";
import { emitIssueDeleted, emitIssueEvent } from "@/lib/server/events.server";
import { notify } from "@/lib/server/notifications.server";
import { requireRepository } from "@/lib/server/repositories.server";
import { issue, team } from "@/lib/server/schema.server";
import { identifierFor } from "@/lib/server/serialize.server";
import { requireTeam } from "@/lib/server/teams.server";
import { handler } from "./$types";

/**
 * Issues are addressed by the identifier people actually say out loud —
 * `ENG-42` — rather than by an opaque id or a number that only means something
 * once you know the team.
 */
const IdentifierParams = v.object({
	slug: v.string(),
	identifier: v.string(),
});

/** Splits `ENG-42`, or 404s on anything that is not one. */
function split(identifier: string): { key: string; number: number } {
	const parsed = parseIdentifier(identifier);
	if (parsed === null) error(404, `"${identifier}" is not an issue identifier`);
	return parsed;
}

export const GET = handler({
	params: IdentifierParams,
	response: IssueSchema,
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "read");
		const { key, number } = split(params.identifier);

		const found = await getIssueByIdentifier(workspace.id, key, number);
		if (found === undefined) error(404, `no issue ${key}-${number}`);
		return found;
	},
});

export const PATCH = handler({
	params: IdentifierParams,
	body: UpdateIssueBody,
	response: IssueSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
		const { key, number } = split(params.identifier);

		const rows = await db
			.select({ issue, team })
			.from(issue)
			.innerJoin(team, eq(team.id, issue.teamId))
			.where(and(eq(team.workspaceId, workspace.id), eq(team.key, key), eq(issue.number, number)))
			.limit(1);

		const row = rows[0];
		if (row === undefined) error(404, `no issue ${key}-${number}`);
		const before = row.issue;

		if (body.assigneeId != null && body.assigneeId !== "") {
			await assertMember(workspace.id, body.assigneeId);
		}

		const changes: Partial<typeof issue.$inferInsert> = { updatedAt: new Date() };
		if (body.title !== undefined) changes.title = body.title;
		if (body.description !== undefined) changes.description = body.description;
		if (body.status !== undefined) changes.status = body.status;
		if (body.priority !== undefined) changes.priority = body.priority;
		if (body.assigneeId !== undefined) changes.assigneeId = body.assigneeId;
		if (body.repositoryId !== undefined) {
			if (body.repositoryId !== null && body.repositoryId !== "") {
				await requireRepository(workspace.id, body.repositoryId);
			}
			changes.repositoryId = body.repositoryId === "" ? null : body.repositoryId;
		}

		// Moving teams changes the identifier: numbers are unique per team, so the
		// issue takes the next free number in its new home rather than keeping one
		// that may already be taken there.
		let identifier = identifierFor(row.team.key, before.number);
		if (body.teamKey !== undefined && body.teamKey !== row.team.key) {
			const destination = await requireTeam(workspace.id, body.teamKey);
			const moved = await insertWithNumber(destination.id, async (candidate) => {
				await db
					.update(issue)
					.set({ ...changes, teamId: destination.id, number: candidate })
					.where(eq(issue.id, before.id));
			});
			identifier = identifierFor(destination.key, moved);
		} else {
			await db.update(issue).set(changes).where(eq(issue.id, before.id));
		}

		if (body.labelIds !== undefined) {
			await setIssueLabels(before.id, await validLabelIds(workspace.id, body.labelIds));
		}

		// Reassignment tells the new owner, and tells the previous one they are off it.
		if (body.assigneeId !== undefined && body.assigneeId !== before.assigneeId) {
			await notify({
				userId: body.assigneeId,
				actorId: user.id,
				onBehalfOfId: locals.agent?.installedByUserId,
				workspaceId: workspace.id,
				issueId: before.id,
				type: "issue_assigned",
				body: `${user.name} assigned ${identifier} to you`,
			});
			await notify({
				userId: before.assigneeId,
				actorId: user.id,
				onBehalfOfId: locals.agent?.installedByUserId,
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
					onBehalfOfId: locals.agent?.installedByUserId,
					workspaceId: workspace.id,
					issueId: before.id,
					type: "issue_status_changed",
					body: message,
				});
			}
		}

		const updated = await getIssueById(before.id);
		if (updated === undefined) error(500, "issue vanished after update");

		// One `issue.updated` for the change as a whole, plus the specific events
		// worth subscribing to on their own. A receiver listening to both sees the
		// assignment twice, which is why the delivery id is the dedupe key.
		const diff: Record<string, { from: unknown; to: unknown }> = {};
		if (body.title !== undefined && body.title !== before.title) {
			diff.title = { from: before.title, to: body.title };
		}
		if (body.description !== undefined && body.description !== before.description) {
			diff.description = { from: before.description, to: body.description };
		}
		if (body.priority !== undefined && body.priority !== before.priority) {
			diff.priority = { from: before.priority, to: body.priority };
		}
		if (body.status !== undefined && body.status !== before.status) {
			diff.status = { from: before.status, to: body.status };
		}
		if (body.repositoryId !== undefined && body.repositoryId !== before.repositoryId) {
			diff.repositoryId = { from: before.repositoryId, to: body.repositoryId };
		}
		if (body.assigneeId !== undefined && body.assigneeId !== before.assigneeId) {
			diff.assigneeId = { from: before.assigneeId, to: body.assigneeId };
		}
		if (body.teamKey !== undefined && body.teamKey !== row.team.key) {
			diff.team = { from: row.team.key, to: body.teamKey };
		}
		if (body.labelIds !== undefined) {
			diff.labels = { from: null, to: updated.labels.map((entry) => entry.name) };
		}

		if (Object.keys(diff).length > 0) {
			await emitIssueEvent("issue.updated", {
				workspace,
				actor: user,
				issue: updated,
				changes: diff,
			});
		}
		if (diff.assigneeId !== undefined) {
			await emitIssueEvent("issue.assigned", {
				workspace,
				actor: user,
				issue: updated,
				changes: diff,
			});
		}
		if (diff.status !== undefined) {
			await emitIssueEvent("issue.status_changed", {
				workspace,
				actor: user,
				issue: updated,
				changes: diff,
			});
		}

		return updated;
	},
});

export const DELETE = handler({
	params: IdentifierParams,
	async handle({ locals, params }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");
		const { key, number } = split(params.identifier);

		const owningTeam = await requireTeam(workspace.id, key);
		const deleted = await db
			.delete(issue)
			.where(and(eq(issue.teamId, owningTeam.id), eq(issue.number, number)))
			.returning({ id: issue.id, title: issue.title });

		const removed = deleted[0];
		if (removed === undefined) error(404, `no issue ${key}-${number}`);

		// The row is gone, so the payload carries what it was rather than a lookup.
		await emitIssueDeleted({
			workspace,
			actor: user,
			issue: {
				id: removed.id,
				identifier: identifierFor(owningTeam.key, number),
				title: removed.title,
				team: { key: owningTeam.key, name: owningTeam.name },
			},
		});
		// 204 — kit turns an undefined return into an empty response.
	},
});
