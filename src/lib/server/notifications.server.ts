import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NotificationType } from "@/lib/domain/issues";
import type { Notification, NotificationOrder } from "@/lib/domain/schemas";
import { findUserMentions } from "@/lib/domain/user-mentions";
import { db } from "./db.server";
import { subscribeToIssue } from "./issues.server";
import {
	issue,
	issueSubscriber,
	notification,
	team,
	user,
	workspace,
	workspaceMember,
} from "./schema.server";
import { identifierFor, toUser } from "./serialize.server";

interface NotifyInput {
	/** Who should see it. Silently dropped when this is the actor. */
	userId: string | null | undefined;
	actorId: string;
	workspaceId: string;
	issueId?: string | null;
	type: NotificationType;
	body: string;
}

/**
 * Writes one inbox entry.
 *
 * Notifying yourself is a no-op — you already know you did it — which is why
 * every caller can pass an assignee straight through without checking first.
 *
 * An agent is not you, even one you installed. It runs unattended for long
 * stretches and its results — a comment with what it found, an issue it moved
 * to In Review, work it handed back to you — are the news you are waiting for.
 * Suppressing them because you authorized the agent once is what emptied the
 * inbox for anyone whose workspace is mostly agent traffic, so the only actor
 * that stays quiet is the recipient themselves.
 */
export async function notify(input: NotifyInput): Promise<void> {
	if (input.userId === null || input.userId === undefined) return;
	if (input.userId === input.actorId) return;

	await db.insert(notification).values({
		id: nanoid(),
		userId: input.userId,
		actorId: input.actorId,
		workspaceId: input.workspaceId,
		issueId: input.issueId ?? null,
		type: input.type,
		body: input.body,
		createdAt: new Date(),
	});
}

/**
 * Everyone who should hear about something happening on an issue.
 *
 * The answer is "whoever follows it" — the `issue_subscriber` rows, which are
 * written for you when you file an issue, when one is assigned to you, when you
 * comment, and when you press Subscribe. Deriving the audience from
 * participation instead (assignee plus creator, which is what every call site
 * used to do inline) meant Subscribe changed nothing about what reached your
 * inbox and unsubscribing from a noisy issue you happened to file changed
 * nothing either.
 *
 * Callers still address assignment notifications at the assignee directly: "X
 * assigned ENG-1 to you" is not news for a bystander.
 */
export async function issueAudience(issueId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: issueSubscriber.userId })
		.from(issueSubscriber)
		.where(eq(issueSubscriber.issueId, issueId));
	return rows.map((row) => row.userId);
}

/**
 * Tells everyone a body names that it named them.
 *
 * Only ids that belong to the workspace get through. The body is written by
 * anyone with an account and by agents, and the mention is a link they could
 * have typed by hand, so "this id was in the text" is not on its own a reason to
 * write into somebody's inbox — the membership check is what makes it one.
 *
 * `already` is who has just been told about this same edit by another route: the
 * assignee who was named in a description they were being assigned in the same
 * breath does not need both. Notifying yourself is already a no-op, so an author
 * writing their own name costs nothing.
 *
 * Being mentioned also subscribes you, the way commenting does. Somebody asked
 * you a question in a thread you were not following, and an answer you never see
 * is the whole reason to have asked.
 *
 * Returns who was told, so a caller announcing the same edit to the issue's
 * followers can leave them out: "mentioned you in ENG-1" and "commented on
 * ENG-1" are one comment, and the first is the one that says why it matters.
 */
export async function notifyMentions(input: {
	body: string;
	slug: string;
	workspaceId: string;
	issueId: string;
	identifier: string;
	actor: { id: string; name: string };
	already?: readonly (string | null | undefined)[];
}): Promise<string[]> {
	const mentioned = findUserMentions(input.body, input.slug);
	if (mentioned.length === 0) return [];

	const told = new Set(input.already ?? []);
	const rows = await db
		.select({ userId: workspaceMember.userId })
		.from(workspaceMember)
		.where(
			and(
				eq(workspaceMember.workspaceId, input.workspaceId),
				inArray(workspaceMember.userId, mentioned),
			),
		);

	const notified: string[] = [];
	for (const row of rows) {
		if (told.has(row.userId)) continue;
		await subscribeToIssue(input.issueId, row.userId);
		await notify({
			userId: row.userId,
			actorId: input.actor.id,
			workspaceId: input.workspaceId,
			issueId: input.issueId,
			type: "issue_mentioned",
			body: `${input.actor.name} mentioned you in ${input.identifier}`,
		});
		notified.push(row.userId);
	}

	return notified;
}

/**
 * Notification types that name you rather than the issue.
 *
 * "Aidan assigned ENG-1 to you" is addressed at one person and is still worth
 * seeing after the issue is closed — someone put that on your plate, and the
 * fact that it ended without you is the part you would want to notice. The rest
 * are broadcasts to everyone following, and a broadcast about an issue that has
 * since been settled is exactly the backlog nobody reads.
 *
 * An `@you` is the same kind of thing: somebody wrote your name, and that they
 * wrote it stays worth knowing after the issue is settled — often *because* it
 * settled without you answering.
 */
const ADDRESSED_TYPES: NotificationType[] = [
	"issue_assigned",
	"issue_unassigned",
	"issue_mentioned",
];

/**
 * Clears the inbox chatter an issue accumulated on its way to being closed.
 *
 * Called at the moment an issue moves into a terminal status, before the
 * notification announcing that move is written — so "moved ENG-1 to Done"
 * arrives unread on top of a clean slate rather than clearing itself.
 *
 * Only what was already waiting is swept. A comment that arrives on an issue
 * that was closed last week is new, so it stays unread; this is about the
 * pile-up behind a decision, not about muting the issue forever.
 */
export async function readNotificationsForClosedIssue(issueId: string): Promise<void> {
	await db
		.update(notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notification.issueId, issueId),
				isNull(notification.readAt),
				notInArray(notification.type, ADDRESSED_TYPES),
			),
		);
}

export async function listNotifications(
	userId: string,
	options: { unreadOnly?: boolean; limit?: number; order?: NotificationOrder } = {},
): Promise<Notification[]> {
	const conditions = [eq(notification.userId, userId)];
	if (options.unreadOnly === true) conditions.push(isNull(notification.readAt));

	// The identifier lives on the issue's team, so a notification that points at
	// an issue joins through to it.
	const rows = await db
		.select({ notification, actor: user, workspace, issue, team })
		.from(notification)
		.innerJoin(user, eq(user.id, notification.actorId))
		.innerJoin(workspace, eq(workspace.id, notification.workspaceId))
		.leftJoin(issue, eq(issue.id, notification.issueId))
		.leftJoin(team, eq(team.id, issue.teamId))
		.where(and(...conditions))
		.orderBy(
			options.order === "oldest" ? asc(notification.createdAt) : desc(notification.createdAt),
		)
		.limit(options.limit ?? 50);

	return rows.map((row) => ({
		id: row.notification.id,
		type: row.notification.type,
		body: row.notification.body,
		read: row.notification.readAt !== null,
		actor: toUser(row.actor),
		workspaceSlug: row.workspace.slug,
		issue:
			row.issue === null || row.team === null
				? null
				: {
						identifier: identifierFor(row.team.key, row.issue.number),
						title: row.issue.title,
						number: row.issue.number,
					},
		createdAt: row.notification.createdAt.toISOString(),
	}));
}

export async function unreadCount(userId: string): Promise<number> {
	const rows = await db
		.select({ id: notification.id })
		.from(notification)
		.where(and(eq(notification.userId, userId), isNull(notification.readAt)));
	return rows.length;
}

/**
 * Flips the read flag on some — or all — of a user's notifications.
 *
 * `ids` omitted means the whole inbox, which is what "mark all read" posts.
 * An empty array is still a no-op rather than "everything": an empty selection
 * arriving from the client must not clear the inbox.
 *
 * Rows already in the target state are excluded so re-marking a read
 * notification does not move its `readAt` forward.
 */
export async function setRead(
	userId: string,
	ids: string[] | undefined,
	read: boolean,
): Promise<void> {
	if (ids !== undefined && ids.length === 0) return;

	const conditions = [
		eq(notification.userId, userId),
		read ? isNull(notification.readAt) : isNotNull(notification.readAt),
	];
	if (ids !== undefined) conditions.push(inArray(notification.id, ids));

	await db
		.update(notification)
		.set({ readAt: read ? new Date() : null })
		.where(and(...conditions));
}
