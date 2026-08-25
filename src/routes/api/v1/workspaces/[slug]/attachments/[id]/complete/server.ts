import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { AttachmentSchema } from "@/lib/domain/schemas";
import { toAttachment } from "@/lib/server/attachments.server";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { attachment, user } from "@/lib/server/schema.server";
import { headObject } from "@/lib/server/storage.server";
import { handler } from "./$types";

/**
 * Marks an upload finished, once the object is confirmed present.
 *
 * The size is re-read from storage rather than trusted from the client: the
 * presigned URL pins a content length, but this is the row that gets shown and
 * counted, so it should reflect what is actually there. Anything over the cap
 * is deleted rather than kept.
 */
export const POST = handler({
	response: AttachmentSchema,
	async handle({ locals, params }) {
		const { workspace, user: actor } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");

		const rows = await db
			.select()
			.from(attachment)
			.where(and(eq(attachment.id, params.id), eq(attachment.workspaceId, workspace.id)))
			.limit(1);

		const row = rows[0];
		if (row === undefined) error(404, "no such attachment");
		if (row.uploadedBy !== actor.id) error(403, "not your upload");

		const object = await headObject(row.key);
		if (object === null) error(409, "the file has not finished uploading");

		await db
			.update(attachment)
			.set({ status: "ready", size: object.size })
			.where(eq(attachment.id, row.id));

		const uploaderRows = await db.select().from(user).where(eq(user.id, row.uploadedBy)).limit(1);
		const uploader = uploaderRows[0];
		if (uploader === undefined) error(500, "uploader vanished");

		return toAttachment({ ...row, status: "ready", size: object.size }, uploader, params.slug);
	},
});
