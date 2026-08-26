/**
 * The issue timeline's write and read side.
 *
 * Recording is deliberately fire-and-forget in spirit: a timeline entry is a
 * note about something that already happened, so a failure to write one must
 * never turn a successful edit into a 500. Callers hand over what changed and
 * this decides nothing else.
 */
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActivityType } from "@/lib/domain/activity";
import type { Activity, Issue } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { issueActivity, user } from "./schema.server";
import { toActivity } from "./serialize.server";

export interface ActivityInput {
	type: ActivityType;
	/** The previous value as text, or null when there wasn't one. */
	from?: string | null;
	/** The new value as text, or null when it was cleared. */
	to?: string | null;
	/** Only for `labels_changed`. */
	labels?: Activity["labels"];
}

/**
 * Appends entries to an issue's timeline.
 *
 * One PATCH can change several properties at once, and `createdAt` is the only
 * ordering the reader has — so entries written together are spaced a
 * millisecond apart rather than landing on the same instant and sorting
 * arbitrarily.
 */
export async function recordActivity(
	issueId: string,
	actorId: string,
	entries: ActivityInput[],
): Promise<void> {
	if (entries.length === 0) return;

	const at = Date.now();
	const rows = entries.map((entry, index) => ({
		id: nanoid(),
		issueId,
		actorId,
		type: entry.type,
		data: JSON.stringify({
			from: entry.from ?? null,
			to: entry.to ?? null,
			labels: entry.labels ?? [],
		}),
		createdAt: new Date(at + index),
	}));

	try {
		await db.insert(issueActivity).values(rows);
	} catch {
		// The edit itself already succeeded; losing its footnote is not worth
		// failing the request over.
	}
}

/**
 * The entries a freshly filed issue starts its timeline with.
 *
 * Anything chosen in the composer — a label, an owner, a repository — happened
 * when the issue was filed, so it is recorded then. Left to the first later
 * edit to notice, it would surface as a change that never happened, stamped
 * with the wrong time. Fields still sitting on their default are left out:
 * "set status to Backlog" on every issue ever filed is noise, not history.
 */
export function creationActivity(created: Issue): ActivityInput[] {
	const entries: ActivityInput[] = [];

	if (created.status !== "backlog") entries.push({ type: "status_changed", to: created.status });
	if (created.priority !== "none") {
		entries.push({ type: "priority_changed", to: created.priority });
	}
	if (created.assignee !== null) {
		entries.push({ type: "assignee_changed", to: created.assignee.name });
	}
	if (created.repository !== null) {
		entries.push({ type: "repository_changed", to: created.repository.fullName });
	}
	if (created.labels.length > 0) {
		entries.push({
			type: "labels_changed",
			labels: created.labels.map((entry) => ({
				name: entry.name,
				color: entry.color,
				added: true,
			})),
		});
	}

	return entries;
}

/** Every recorded entry for one issue, oldest first — the order it reads in. */
export async function listActivity(issueId: string): Promise<Activity[]> {
	const rows = await db
		.select({ activity: issueActivity, actor: user })
		.from(issueActivity)
		.innerJoin(user, eq(user.id, issueActivity.actorId))
		.where(eq(issueActivity.issueId, issueId))
		.orderBy(asc(issueActivity.createdAt));

	return rows.map((row) => toActivity(row.activity, row.actor));
}
