import { error } from "@implementjs/kit/server";
import { and, count, desc, eq, inArray, isNull, like, max, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { IssuePriority, IssueStatus } from "@/lib/domain/issues";
import type { Issue } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { comment, issue, issueLabel, label, team, user, workspaceMember } from "./schema.server";
import { toIssue } from "./serialize.server";

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
}

/**
 * Issues carry their team rather than their workspace, so every read joins
 * `team` — which is also what scopes a query to a workspace.
 */
const baseSelect = {
	issue,
	team,
	assignee: assigneeUser,
	creator: creatorUser,
};

type IssueRows = Array<{
	issue: typeof issue.$inferSelect;
	team: typeof team.$inferSelect;
	assignee: typeof user.$inferSelect | null;
	creator: typeof user.$inferSelect;
}>;

const withJoins = () =>
	db
		.select(baseSelect)
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.leftJoin(assigneeUser, eq(assigneeUser.id, issue.assigneeId))
		.innerJoin(creatorUser, eq(creatorUser.id, issue.creatorId));

/**
 * Attaches labels and comment counts to a page of issue rows.
 *
 * Two extra queries for the whole page rather than two per row — the join that
 * would fetch labels inline multiplies the issue rows by their label count and
 * makes the comment count wrong.
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

	return rows.map((row) =>
		toIssue(row.issue, {
			team: row.team,
			assignee: row.assignee,
			creator: row.creator,
			labels: (labelsByIssue.get(row.issue.id) ?? []).toSorted((a, b) =>
				a.name.localeCompare(b.name),
			),
			commentCount: countsByIssue.get(row.issue.id) ?? 0,
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
