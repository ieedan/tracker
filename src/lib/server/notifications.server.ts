import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NotificationType } from "@/lib/domain/issues";
import type { Notification } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { issue, notification, user, workspace } from "./schema.server";
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

export async function listNotifications(
	userId: string,
	options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
	const conditions = [eq(notification.userId, userId)];
	if (options.unreadOnly === true) conditions.push(isNull(notification.readAt));

	const rows = await db
		.select({ notification, actor: user, workspace, issue })
		.from(notification)
		.innerJoin(user, eq(user.id, notification.actorId))
		.innerJoin(workspace, eq(workspace.id, notification.workspaceId))
		.leftJoin(issue, eq(issue.id, notification.issueId))
		.where(and(...conditions))
		.orderBy(desc(notification.createdAt))
		.limit(options.limit ?? 50);

	return rows.map((row) => ({
		id: row.notification.id,
		type: row.notification.type,
		body: row.notification.body,
		read: row.notification.readAt !== null,
		actor: toUser(row.actor),
		workspaceSlug: row.workspace.slug,
		issue:
			row.issue === null
				? null
				: {
						identifier: identifierFor(row.workspace.key, row.issue.number),
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

export async function markRead(userId: string, ids?: string[]): Promise<void> {
	// Marking nothing is a no-op, not "mark everything" — an empty selection
	// arriving from the client must not clear the whole inbox.
	if (ids !== undefined && ids.length === 0) return;

	const conditions = [eq(notification.userId, userId), isNull(notification.readAt)];
	if (ids !== undefined) conditions.push(inArray(notification.id, ids));

	await db
		.update(notification)
		.set({ readAt: new Date() })
		.where(and(...conditions));
}
