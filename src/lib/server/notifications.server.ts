import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NotificationType } from "@/lib/domain/issues";
import type { Notification, NotificationOrder } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { issue, notification, team, user, workspace } from "./schema.server";
import { identifierFor, toUser } from "./serialize.server";

interface NotifyInput {
	/** Who should see it. Silently dropped when this is the actor. */
	userId: string | null | undefined;
	actorId: string;
	/**
	 * When an agent is acting, the human who authorized it — pass
	 * `locals.agent?.installedByUserId`.
	 *
	 * Their agent doing something on their behalf is still them doing it, so it
	 * is dropped the same way notifying yourself is.
	 */
	onBehalfOfId?: string | null | undefined;
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
 * That extends to your own agent: it acts on your delegation, so its work does
 * not come back to you as news.
 */
export async function notify(input: NotifyInput): Promise<void> {
	if (input.userId === null || input.userId === undefined) return;
	if (input.userId === input.actorId) return;
	if (input.userId === input.onBehalfOfId) return;

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
