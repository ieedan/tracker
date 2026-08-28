/**
 * Reading, writing and converting user feedback.
 *
 * Two audiences read from here: workspace members through the API, and anyone
 * at all through the public board. `audience` is threaded through every read
 * rather than left to the caller, because the difference between the two is not
 * cosmetic — a public response must not carry a submitter's email address, and
 * a public listing must not carry private feedback at all.
 */
import { error } from "@implementjs/kit/server";
import { and, asc, count, desc, eq, inArray, like, max, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import {
	FEEDBACK_LABEL_COLOR,
	FEEDBACK_LABEL_NAME,
	type FeedbackStatus,
	type FeedbackVisibility,
} from "@/lib/domain/feedback";
import type { Feedback, FeedbackComment } from "@/lib/domain/schemas";
import { db } from "./db.server";
import {
	feedback,
	feedbackComment,
	feedbackLabel,
	feedbackSubscriber,
	issue,
	label,
	team,
	user,
} from "./schema.server";
import { identifierFor, toFeedback, toFeedbackComment } from "./serialize.server";

export type Audience = "member" | "public";

type Row = typeof feedback.$inferSelect;

export interface FeedbackFilters {
	status?: FeedbackStatus[];
	visibility?: FeedbackVisibility;
	search?: string;
	/** `true` for feedback that has become an issue, `false` for the rest. */
	converted?: boolean;
}

/**
 * Attaches labels, counts and the converted issue to a page of feedback rows.
 *
 * Same shape as the issue hydrator and for the same reason: joining labels
 * inline multiplies the rows and makes every count wrong.
 */
async function hydrate(
	rows: Array<{
		feedback: Row;
		submitter: typeof user.$inferSelect | null;
		assignee: typeof user.$inferSelect | null;
	}>,
	audience: Audience,
): Promise<Feedback[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((row) => row.feedback.id);

	const labelRows = await db
		.select({ feedbackId: feedbackLabel.feedbackId, label })
		.from(feedbackLabel)
		.innerJoin(label, eq(label.id, feedbackLabel.labelId))
		.where(inArray(feedbackLabel.feedbackId, ids));

	// Internal notes are invisible to the public board, so they must not be
	// counted there either — a "3 replies" that shows one is worse than no count.
	const commentScope =
		audience === "public"
			? and(inArray(feedbackComment.feedbackId, ids), eq(feedbackComment.internal, false))
			: inArray(feedbackComment.feedbackId, ids);

	const commentCounts = await db
		.select({ feedbackId: feedbackComment.feedbackId, total: count() })
		.from(feedbackComment)
		.where(commentScope)
		.groupBy(feedbackComment.feedbackId);

	const subscriberCounts = await db
		.select({ feedbackId: feedbackSubscriber.feedbackId, total: count() })
		.from(feedbackSubscriber)
		.where(inArray(feedbackSubscriber.feedbackId, ids))
		.groupBy(feedbackSubscriber.feedbackId);

	const issueRows = await db
		.select({ issue, team })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(inArray(issue.feedbackId, ids));

	const labelsByFeedback = new Map<string, Array<typeof label.$inferSelect>>();
	for (const row of labelRows) {
		const list = labelsByFeedback.get(row.feedbackId) ?? [];
		list.push(row.label);
		labelsByFeedback.set(row.feedbackId, list);
	}

	const comments = new Map(commentCounts.map((row) => [row.feedbackId, row.total]));
	const subscribers = new Map(subscriberCounts.map((row) => [row.feedbackId, row.total]));
	const issues = new Map(
		issueRows.map((row) => [
			row.issue.feedbackId!,
			{
				id: row.issue.id,
				identifier: identifierFor(row.team.key, row.issue.number),
				title: row.issue.title,
			},
		]),
	);

	return rows.map((row) =>
		toFeedback(row.feedback, {
			labels: (labelsByFeedback.get(row.feedback.id) ?? []).toSorted((a, b) =>
				a.name.localeCompare(b.name),
			),
			submitter: row.submitter,
			assignee: row.assignee,
			commentCount: comments.get(row.feedback.id) ?? 0,
			subscriberCount: subscribers.get(row.feedback.id) ?? 0,
			issue: issues.get(row.feedback.id) ?? null,
			audience,
		}),
	);
}

/**
 * Two joins onto the same table, so both need an alias — the submitter is who
 * sent it, the assignee is who is dealing with it, and they are rarely the
 * same person.
 */
const submitterUser = alias(user, "submitter_user");
const assigneeUser = alias(user, "assignee_user");

const withPeople = () =>
	db
		.select({ feedback, submitter: submitterUser, assignee: assigneeUser })
		.from(feedback)
		.leftJoin(submitterUser, eq(submitterUser.id, feedback.submitterUserId))
		.leftJoin(assigneeUser, eq(assigneeUser.id, feedback.assigneeId));

export async function listFeedback(
	workspaceId: string,
	options: { audience: Audience; filters?: FeedbackFilters },
): Promise<Feedback[]> {
	const filters = options.filters ?? {};
	const conditions: SQL[] = [eq(feedback.workspaceId, workspaceId)];

	// Not a filter the caller can turn off: the public board is only ever the
	// public rows.
	if (options.audience === "public") {
		conditions.push(eq(feedback.visibility, "public"));
	} else if (filters.visibility !== undefined) {
		conditions.push(eq(feedback.visibility, filters.visibility));
	}

	if (filters.status !== undefined && filters.status.length > 0) {
		conditions.push(inArray(feedback.status, filters.status));
	}
	if (filters.search !== undefined && filters.search.trim() !== "") {
		const term = `%${filters.search.trim().toLowerCase()}%`;
		const match = or(like(feedback.title, term), like(feedback.description, term));
		if (match !== undefined) conditions.push(match);
	}

	const rows = await withPeople()
		.where(and(...conditions))
		.orderBy(desc(feedback.createdAt));

	const hydrated = await hydrate(rows, options.audience);
	if (filters.converted === undefined) return hydrated;
	return hydrated.filter((entry) => (entry.issue !== null) === filters.converted);
}

/** One piece of feedback by its number — the `12` in `FB-12`. */
export async function getFeedbackByNumber(
	workspaceId: string,
	number: number,
	audience: Audience,
): Promise<Feedback | undefined> {
	const rows = await withPeople()
		.where(and(eq(feedback.workspaceId, workspaceId), eq(feedback.number, number)))
		.limit(1);

	const found = rows[0];
	if (found === undefined) return undefined;
	// A private item is not "forbidden" to the public, it does not exist —
	// otherwise the board leaks how much private feedback a workspace holds.
	if (audience === "public" && found.feedback.visibility !== "public") return undefined;

	const hydrated = await hydrate([found], audience);
	return hydrated[0];
}

export async function getFeedbackById(
	id: string,
	audience: Audience = "member",
): Promise<Feedback | undefined> {
	const rows = await withPeople().where(eq(feedback.id, id)).limit(1);
	const found = rows[0];
	if (found === undefined) return undefined;
	const hydrated = await hydrate([found], audience);
	return hydrated[0];
}

/** The raw row, for the guards that need `workspaceId` before deciding anything. */
export async function findFeedbackRow(workspaceId: string, id: string): Promise<Row | undefined> {
	const rows = await db
		.select()
		.from(feedback)
		.where(and(eq(feedback.id, id), eq(feedback.workspaceId, workspaceId)))
		.limit(1);
	return rows[0];
}

/**
 * Allocates the next `FB-` number and inserts, retrying on collision.
 *
 * Same read-then-write race as issue numbers, and the same answer: the unique
 * index on (workspaceId, number) is what actually prevents two pieces of
 * feedback sharing a reference, and a lost race is just another attempt.
 */
export async function insertFeedback(values: {
	workspaceId: string;
	title: string;
	description: string;
	visibility: FeedbackVisibility;
	submitterName: string | null;
	submitterEmail: string | null;
	submitterUserId: string | null;
	source: string | null;
}): Promise<Row> {
	const id = nanoid();
	let lastFailure: unknown;

	for (let attempt = 0; attempt < 5; attempt++) {
		const highest = await db
			.select({ highest: max(feedback.number) })
			.from(feedback)
			.where(eq(feedback.workspaceId, values.workspaceId));
		const number = (highest[0]?.highest ?? 0) + 1;

		const row = {
			id,
			workspaceId: values.workspaceId,
			number,
			title: values.title,
			description: values.description,
			status: "new" as const,
			// Ranked and assigned by triage, never by the person submitting it —
			// nobody files their own request as Urgent and means it.
			priority: "none" as const,
			assigneeId: null,
			visibility: values.visibility,
			submitterName: values.submitterName,
			submitterEmail: values.submitterEmail,
			submitterUserId: values.submitterUserId,
			source: values.source,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			await db.insert(feedback).values(row);
			return row;
		} catch (cause) {
			lastFailure = cause;
			const message = cause instanceof Error ? cause.message : String(cause);
			if (!message.includes("UNIQUE") && !message.includes("constraint")) throw cause;
		}
	}
	throw lastFailure;
}

export async function setFeedbackLabels(feedbackId: string, labelIds: string[]): Promise<void> {
	await db.delete(feedbackLabel).where(eq(feedbackLabel.feedbackId, feedbackId));
	if (labelIds.length === 0) return;
	await db
		.insert(feedbackLabel)
		.values(labelIds.map((labelId) => ({ feedbackId, labelId })))
		.onConflictDoNothing();
}

export async function labelIdsFor(feedbackId: string): Promise<string[]> {
	const rows = await db
		.select({ labelId: feedbackLabel.labelId })
		.from(feedbackLabel)
		.where(eq(feedbackLabel.feedbackId, feedbackId));
	return rows.map((row) => row.labelId);
}

/**
 * Records an interest in updates. Idempotent by (feedback, email) — clicking
 * subscribe twice should not mean hearing about it twice.
 *
 * Nothing sends mail yet, by design; the point right now is that the list is
 * being kept, so it is already populated on the day sending is switched on.
 */
export async function subscribeToFeedback(options: {
	feedbackId: string;
	email: string;
	userId: string | null;
}): Promise<void> {
	await db
		.insert(feedbackSubscriber)
		.values({
			id: nanoid(),
			feedbackId: options.feedbackId,
			email: options.email.trim().toLowerCase(),
			userId: options.userId,
			createdAt: new Date(),
		})
		.onConflictDoNothing();
}

export async function listFeedbackComments(
	feedbackId: string,
	audience: Audience,
): Promise<FeedbackComment[]> {
	const conditions: SQL[] = [eq(feedbackComment.feedbackId, feedbackId)];
	if (audience === "public") conditions.push(eq(feedbackComment.internal, false));

	const rows = await db
		.select({ comment: feedbackComment, author: user })
		.from(feedbackComment)
		.innerJoin(user, eq(user.id, feedbackComment.authorId))
		.where(and(...conditions))
		.orderBy(asc(feedbackComment.createdAt));

	return rows.map((row) => toFeedbackComment(row.comment, row.author, audience));
}

/**
 * The workspace's "user feedback" label, created the first time it is needed.
 *
 * Made on demand rather than at workspace creation so a workspace that never
 * takes feedback never grows a label for it.
 */
export async function feedbackLabelId(workspaceId: string): Promise<string> {
	const existing = await db
		.select({ id: label.id })
		.from(label)
		.where(and(eq(label.workspaceId, workspaceId), eq(label.name, FEEDBACK_LABEL_NAME)))
		.limit(1);

	const found = existing[0];
	if (found !== undefined) return found.id;

	const id = nanoid();
	await db
		.insert(label)
		.values({
			id,
			workspaceId,
			name: FEEDBACK_LABEL_NAME,
			color: FEEDBACK_LABEL_COLOR,
			createdAt: new Date(),
		})
		.onConflictDoNothing();

	// A concurrent create may have won; re-read rather than trust the insert.
	const after = await db
		.select({ id: label.id })
		.from(label)
		.where(and(eq(label.workspaceId, workspaceId), eq(label.name, FEEDBACK_LABEL_NAME)))
		.limit(1);

	const settled = after[0];
	if (settled === undefined) error(500, "could not create the user feedback label");
	return settled.id;
}

/** The issue a piece of feedback was already converted into, if any. */
export async function convertedIssue(
	feedbackId: string,
): Promise<{ id: string; identifier: string; title: string } | null> {
	const rows = await db
		.select({ issue, team })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(eq(issue.feedbackId, feedbackId))
		.limit(1);

	const row = rows[0];
	if (row === undefined) return null;
	return {
		id: row.issue.id,
		identifier: identifierFor(row.team.key, row.issue.number),
		title: row.issue.title,
	};
}

export async function touchFeedback(id: string): Promise<void> {
	await db.update(feedback).set({ updatedAt: new Date() }).where(eq(feedback.id, id));
}
