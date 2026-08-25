import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { MAX_ATTACHMENT_BYTES, isAllowedType } from "@/lib/domain/attachments";
import { AttachmentSchema, CreateAttachmentBody } from "@/lib/domain/schemas";
import { toAttachment } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { requireMembership } from "@/lib/server/guards.server";
import { attachment, comment, issue, team } from "@/lib/server/schema.server";
import { attachmentKey, presignUpload, storageConfigured } from "@/lib/server/storage.server";
import { handler, json } from "./$types";

/**
 * Reserves an attachment and hands back a URL to PUT the bytes to.
 *
 * The upload does not pass through this server — see `storage.server.ts` for
 * why. The row is written first so an abandoned upload is a `pending` row
 * rather than a file nobody can account for.
 */
export const POST = handler({
	body: CreateAttachmentBody,
	response: v.object({
		attachment: AttachmentSchema,
		uploadUrl: v.string(),
		/** The exact header the PUT must send, since it is inside the signature. */
		contentType: v.string(),
	}),
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);

		if (!storageConfigured()) {
			error(503, "attachment storage is not configured on this server");
		}
		if (!isAllowedType(body.contentType)) {
			error(415, `${body.contentType} files cannot be uploaded`);
		}
		if (body.size > MAX_ATTACHMENT_BYTES) {
			error(413, `files must be under ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB`);
		}

		// A parent must belong to this workspace; otherwise an attachment could be
		// hung off another workspace's issue by id.
		if (body.issueId !== undefined) await assertIssueInWorkspace(workspace.id, body.issueId);
		if (body.commentId !== undefined) await assertCommentInWorkspace(workspace.id, body.commentId);

		const contentType = body.contentType.toLowerCase().split(";")[0]!.trim();
		const key = attachmentKey(workspace.id, body.filename);

		const row = {
			id: nanoid(),
			workspaceId: workspace.id,
			key,
			filename: body.filename,
			contentType,
			size: body.size,
			status: "pending" as const,
			uploadedBy: user.id,
			issueId: body.issueId ?? null,
			commentId: body.commentId ?? null,
			createdAt: new Date(),
		};
		await db.insert(attachment).values(row);

		const uploadUrl = await presignUpload({ key, contentType, size: body.size });

		return json(
			{
				attachment: toAttachment(row, { ...user, image: user.image }, params.slug),
				uploadUrl,
				contentType,
			},
			{ status: 201 },
		);
	},
});

async function assertIssueInWorkspace(workspaceId: string, issueId: string): Promise<void> {
	const rows = await db
		.select({ id: issue.id })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(and(eq(issue.id, issueId), eq(team.workspaceId, workspaceId)))
		.limit(1);
	if (rows.length === 0) error(404, "no such issue in this workspace");
}

async function assertCommentInWorkspace(workspaceId: string, commentId: string): Promise<void> {
	const rows = await db
		.select({ id: comment.id })
		.from(comment)
		.innerJoin(issue, eq(issue.id, comment.issueId))
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(and(eq(comment.id, commentId), eq(team.workspaceId, workspaceId)))
		.limit(1);
	if (rows.length === 0) error(404, "no such comment in this workspace");
}
