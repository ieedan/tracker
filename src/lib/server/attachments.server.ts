import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Attachment } from "@/lib/domain/schemas";
import { db } from "./db.server";
import { attachment, user } from "./schema.server";
import { toUser, type UserFields } from "./serialize.server";

type Row = typeof attachment.$inferSelect;

/**
 * The URL handed to the browser points at *this app*, not at storage.
 *
 * This one is stable and same-origin, so `<img src>` can send the session
 * cookie. The route behind it streams the object from storage.
 */
export function attachmentUrl(slug: string, id: string): string {
	return `/api/v1/workspaces/${slug}/attachments/${id}`;
}

export function toAttachment(row: Row, uploader: UserFields, slug: string): Attachment {
	return {
		id: row.id,
		filename: row.filename,
		contentType: row.contentType,
		size: row.size,
		url: attachmentUrl(slug, row.id),
		uploadedBy: toUser(uploader),
		createdAt: row.createdAt.toISOString(),
	};
}

/** Ready attachments hanging off a set of issues or comments, grouped by parent. */
export async function attachmentsFor(
	slug: string,
	target: { issueIds?: string[]; commentIds?: string[] },
): Promise<{ byIssue: Map<string, Attachment[]>; byComment: Map<string, Attachment[]> }> {
	const byIssue = new Map<string, Attachment[]>();
	const byComment = new Map<string, Attachment[]>();

	const issueIds = target.issueIds ?? [];
	const commentIds = target.commentIds ?? [];
	if (issueIds.length === 0 && commentIds.length === 0) return { byIssue, byComment };

	const scopes = [];
	if (issueIds.length > 0) scopes.push(inArray(attachment.issueId, issueIds));
	if (commentIds.length > 0) scopes.push(inArray(attachment.commentId, commentIds));

	const rows = await db
		.select({ attachment, uploader: user })
		.from(attachment)
		.innerJoin(user, eq(user.id, attachment.uploadedBy))
		.where(and(eq(attachment.status, "ready"), scopes.length === 1 ? scopes[0] : or(...scopes)))
		.orderBy(asc(attachment.createdAt));

	for (const row of rows) {
		const value = toAttachment(row.attachment, row.uploader, slug);
		if (row.attachment.issueId !== null) {
			byIssue.set(row.attachment.issueId, [...(byIssue.get(row.attachment.issueId) ?? []), value]);
		}
		if (row.attachment.commentId !== null) {
			byComment.set(row.attachment.commentId, [
				...(byComment.get(row.attachment.commentId) ?? []),
				value,
			]);
		}
	}

	return { byIssue, byComment };
}

/**
 * Attaches uploads that were made while drafting to the comment that was just
 * created. Only the drafter's own unattached, ready uploads in this workspace —
 * so an id from somewhere else cannot be adopted.
 */
export async function adoptDraftAttachments(options: {
	ids: string[];
	issueId?: string;
	commentId?: string;
	workspaceId: string;
	userId: string;
}): Promise<void> {
	if (options.ids.length === 0) return;

	const parent: { issueId?: string; commentId?: string } = {};
	if (options.issueId !== undefined) parent.issueId = options.issueId;
	if (options.commentId !== undefined) parent.commentId = options.commentId;
	if (parent.issueId === undefined && parent.commentId === undefined) return;

	await db
		.update(attachment)
		.set(parent)
		.where(
			and(
				inArray(attachment.id, options.ids),
				eq(attachment.workspaceId, options.workspaceId),
				eq(attachment.uploadedBy, options.userId),
				isNull(attachment.commentId),
				isNull(attachment.issueId),
			),
		);
}
