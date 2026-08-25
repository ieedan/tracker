import { error } from "@implementjs/kit/server";
import { and, count, desc, eq, inArray, isNull, like, max, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { parseIdentifier, type IssuePriority, type IssueStatus } from "@/lib/domain/issues";
import type { Issue } from "@/lib/domain/schemas";
import { attachmentsFor } from "./attachments.server";
import { db } from "./db.server";
import { emitIssueDeleted, emitIssueEvent } from "./events.server";
import type { Membership } from "./guards.server";
import {
	attachment,
	comment,
	feedback,
	issue,
	pullRequest,
	repository,
	issueLabel,
	label,
	notification,
	team,
	user,
	workspace,
	workspaceMember,
} from "./schema.server";
import { identifierFor, toIssue } from "./serialize.server";
import { requireTeam } from "./teams.server";

const assigneeUser = alias(user, "assignee_user");
const creatorUser = alias(user, "creator_user");

export interface IssueFilters {
	status?: IssueStatus[];
	assigneeId?: string;
	/** `true` matches issues with no assignee. */
	unassigned?: boolean;
	priority?: IssuePriority[];
	search?: string;
	/** Restrict to one team, by its key (`ENG`). */
	teamKey?: string;
	/** Restrict to one linked repository. */
	repositoryId?: string;
}

/**
 * Issues carry their team rather than their workspace, so every read joins
 * `team` — which is also what scopes a query to a workspace.
 */
const baseSelect = {
	issue,
	team,
	// Only for the slug: an attachment's URL is addressed by workspace, and the
	// issue itself only knows its team.
	workspace,
	assignee: assigneeUser,
	creator: creatorUser,
	// Present only on issues converted from feedback, which is most of them
	// never — a left join costs less than a second query that usually finds
	// nothing.
	feedback,
	repository,
	pullRequest,
};

type IssueRows = Array<{
	issue: typeof issue.$inferSelect;
	team: typeof team.$inferSelect;
	workspace: typeof workspace.$inferSelect;
	assignee: typeof user.$inferSelect | null;
	creator: typeof user.$inferSelect;
	feedback: typeof feedback.$inferSelect | null;
	repository: typeof repository.$inferSelect | null;
	pullRequest: typeof pullRequest.$inferSelect | null;
}>;

const withJoins = () =>
	db
		.select(baseSelect)
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.innerJoin(workspace, eq(workspace.id, team.workspaceId))
		.leftJoin(assigneeUser, eq(assigneeUser.id, issue.assigneeId))
		.innerJoin(creatorUser, eq(creatorUser.id, issue.creatorId))
		.leftJoin(feedback, eq(feedback.id, issue.feedbackId))
		.leftJoin(repository, eq(repository.id, issue.repositoryId))
		.leftJoin(pullRequest, eq(pullRequest.issueId, issue.id));

/**
 * Attaches labels, comment counts and attachments to a page of issue rows.
 *
 * Three extra queries for the whole page rather than three per row — the join
 * that would fetch labels inline multiplies the issue rows by their label count
 * and makes the comment count wrong.
 */
async function hydrate(rows: IssueRows): Promise<Issue[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((row) => row.issue.id);

	const labelRows = await db
		.select({ issueId: issueLabel.issueId, label })
		.from(issueLabel)
		.innerJoin(label, eq(label.id, issueLabel.labelId))
		.where(inArray(issueLabel.issueId, ids));

	const countRows = await db
		.select({ issueId: comment.issueId, total: count() })
		.from(comment)
		.where(inArray(comment.issueId, ids))
		.groupBy(comment.issueId);

	const labelsByIssue = new Map<string, Array<typeof label.$inferSelect>>();
	for (const row of labelRows) {
		const list = labelsByIssue.get(row.issueId) ?? [];
		list.push(row.label);
		labelsByIssue.set(row.issueId, list);
	}

	const countsByIssue = new Map(countRows.map((row) => [row.issueId, row.total]));

	// Every query above is scoped to one workspace — a list by `team.workspaceId`
	// and a lookup to a single row — so one slug addresses the whole page.
	const { byIssue: attachmentsByIssue } = await attachmentsFor(rows[0]!.workspace.slug, {
		issueIds: ids,
	});

	return rows.map((row) =>
		toIssue(row.issue, {
			team: row.team,
			assignee: row.assignee,
			creator: row.creator,
			labels: (labelsByIssue.get(row.issue.id) ?? []).toSorted((a, b) =>
				a.name.localeCompare(b.name),
			),
			commentCount: countsByIssue.get(row.issue.id) ?? 0,
			attachments: attachmentsByIssue.get(row.issue.id) ?? [],
			feedback: row.feedback,
			repository: row.repository,
			pullRequest: row.pullRequest,
		}),
	);
}

/** Every issue in the workspace, across teams, newest activity first. */
export async function listIssues(
	workspaceId: string,
	filters: IssueFilters = {},
): Promise<Issue[]> {
	const conditions: SQL[] = [eq(team.workspaceId, workspaceId)];

	if (filters.teamKey !== undefined) conditions.push(eq(team.key, filters.teamKey));
	if (filters.status !== undefined && filters.status.length > 0) {
		conditions.push(inArray(issue.status, filters.status));
	}
	if (filters.priority !== undefined && filters.priority.length > 0) {
		conditions.push(inArray(issue.priority, filters.priority));
	}
	if (filters.unassigned === true) {
		conditions.push(isNull(issue.assigneeId));
	} else if (filters.assigneeId !== undefined) {
		conditions.push(eq(issue.assigneeId, filters.assigneeId));
	}
	if (filters.repositoryId !== undefined) {
		conditions.push(eq(issue.repositoryId, filters.repositoryId));
	}
	if (filters.search !== undefined && filters.search.trim() !== "") {
		const term = `%${filters.search.trim().toLowerCase()}%`;
		const match = or(like(issue.title, term), like(issue.description, term));
		if (match !== undefined) conditions.push(match);
	}

	const rows = await withJoins()
		.where(and(...conditions))
		.orderBy(desc(issue.updatedAt));

	return await hydrate(rows);
}

/** One issue, addressed the way the UI addresses it: `ENG-42`. */
export async function getIssueByIdentifier(
	workspaceId: string,
	teamKey: string,
	number: number,
): Promise<Issue | undefined> {
	const rows = await withJoins()
		.where(and(eq(team.workspaceId, workspaceId), eq(team.key, teamKey), eq(issue.number, number)))
		.limit(1);

	const hydrated = await hydrate(rows);
	return hydrated[0];
}

export async function getIssueById(id: string): Promise<Issue | undefined> {
	const rows = await withJoins().where(eq(issue.id, id)).limit(1);
	const hydrated = await hydrate(rows);
	return hydrated[0];
}

/**
 * The next per-team issue number.
 *
 * This is a read-then-write and libSQL gives us no transaction across the HTTP
 * driver, so two simultaneous creates in the same team can read the same
 * maximum. The unique index on (teamId, number) turns that into a failed insert
 * rather than two issues sharing an identifier, and the caller retries.
 */
export async function nextIssueNumber(teamId: string): Promise<number> {
	const rows = await db
		.select({ highest: max(issue.number) })
		.from(issue)
		.where(eq(issue.teamId, teamId));
	return (rows[0]?.highest ?? 0) + 1;
}

/**
 * Allocates a number and inserts, retrying when a concurrent create takes the
 * number first. Returns the number that stuck.
 */
export async function insertWithNumber(
	teamId: string,
	insert: (candidate: number) => Promise<void>,
): Promise<number> {
	let lastFailure: unknown;
	for (let attempt = 0; attempt < 5; attempt++) {
		const candidate = await nextIssueNumber(teamId);
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

export async function setIssueLabels(issueId: string, labelIds: string[]): Promise<void> {
	await db.delete(issueLabel).where(eq(issueLabel.issueId, issueId));
	if (labelIds.length === 0) return;
	await db
		.insert(issueLabel)
		.values(labelIds.map((labelId) => ({ issueId, labelId })))
		.onConflictDoNothing();
}

/** 400s when the proposed assignee is not in the workspace. */
export async function assertMember(workspaceId: string, userId: string): Promise<void> {
	const rows = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
		.limit(1);
	if (rows.length === 0) error(400, "assignee is not a member of this workspace");
}

/** 400s when any label id belongs to another workspace or does not exist. */
export async function validLabelIds(workspaceId: string, ids: string[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const unique = [...new Set(ids)];
	const rows = await db
		.select({ id: label.id })
		.from(label)
		.where(and(eq(label.workspaceId, workspaceId), inArray(label.id, unique)));
	if (rows.length !== unique.length) error(400, "one or more labels are not in this workspace");
	return rows.map((row) => row.id);
}

/** True when `userId` is already in the workspace — unlike `assertMember`, a miss is not an error. */
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: workspaceMember.id })
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
		.limit(1);
	return rows.length > 0;
}

/**
 * Moves an issue into another workspace.
 *
 * The identifier is per-team, so the number is reallocated in the destination.
 * Labels are matched by exact name (dropped when the dest has no namesake),
 * the assignee is kept only if they belong there, and linked feedback stays
 * behind. Comments hang off the issue id and come along for free.
 */
export async function transferIssue(options: {
	source: Membership;
	dest: Membership;
	identifier: string;
	teamKey: string;
}): Promise<Issue> {
	if (options.dest.workspace.id === options.source.workspace.id) {
		error(400, "use the team field to move within a workspace");
	}

	const parsed = parseIdentifier(options.identifier);
	if (parsed === null) error(404, `"${options.identifier}" is not an issue identifier`);

	const rows = await db
		.select({ issue, team })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(
			and(
				eq(team.workspaceId, options.source.workspace.id),
				eq(team.key, parsed.key),
				eq(issue.number, parsed.number),
			),
		)
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, `no issue ${parsed.key}-${parsed.number}`);
	const before = row.issue;
	const left = {
		id: before.id,
		identifier: identifierFor(row.team.key, before.number),
		title: before.title,
		team: { key: row.team.key, name: row.team.name },
	};

	const destTeam = await requireTeam(options.dest.workspace.id, options.teamKey);

	const assigneeId =
		before.assigneeId !== null && (await isMember(options.dest.workspace.id, before.assigneeId))
			? before.assigneeId
			: null;

	const labelNames = (
		await db
			.select({ name: label.name })
			.from(issueLabel)
			.innerJoin(label, eq(label.id, issueLabel.labelId))
			.where(eq(issueLabel.issueId, before.id))
	).map((entry) => entry.name);

	await insertWithNumber(destTeam.id, async (candidate) => {
		await db
			.update(issue)
			.set({
				teamId: destTeam.id,
				number: candidate,
				updatedAt: new Date(),
				assigneeId,
				feedbackId: null,
			})
			.where(eq(issue.id, before.id));
	});

	let destLabelIds: string[] = [];
	if (labelNames.length > 0) {
		destLabelIds = (
			await db
				.select({ id: label.id })
				.from(label)
				.where(
					and(eq(label.workspaceId, options.dest.workspace.id), inArray(label.name, labelNames)),
				)
		).map((entry) => entry.id);
	}
	await setIssueLabels(before.id, destLabelIds);

	await db
		.update(attachment)
		.set({ workspaceId: options.dest.workspace.id })
		.where(eq(attachment.issueId, before.id));

	const commentIds = (
		await db.select({ id: comment.id }).from(comment).where(eq(comment.issueId, before.id))
	).map((entry) => entry.id);
	if (commentIds.length > 0) {
		await db
			.update(attachment)
			.set({ workspaceId: options.dest.workspace.id })
			.where(inArray(attachment.commentId, commentIds));
	}

	await db
		.update(notification)
		.set({ workspaceId: options.dest.workspace.id })
		.where(eq(notification.issueId, before.id));

	await emitIssueDeleted({
		workspace: options.source.workspace,
		actor: options.source.user,
		issue: left,
	});

	const moved = await getIssueById(before.id);
	if (moved === undefined) error(500, "issue vanished after transfer");

	await emitIssueEvent("issue.created", {
		workspace: options.dest.workspace,
		actor: options.source.user,
		issue: moved,
	});

	return moved;
}
