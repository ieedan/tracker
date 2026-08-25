import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { isInline } from "@/lib/domain/attachments";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { attachment } from "@/lib/server/schema.server";
import { deleteObject, streamObject } from "@/lib/server/storage.server";
import type { RequestEvent } from "./$types";

/**
 * Serves the file at a stable app URL.
 *
 * A plain handler rather than a `handler()`, because the answer is bytes
 * rather than JSON. The page keeps this URL forever; this route is what
 * actually talks to storage, so a presigned hop does not have to.
 */
export async function GET(event: RequestEvent): Promise<Response> {
	const { workspace } = await requireMembership(event.locals, event.params.slug);
	requirePermission(event.locals, "issues", "read");

	const rows = await db
		.select()
		.from(attachment)
		.where(
			and(
				eq(attachment.id, event.params.id),
				eq(attachment.workspaceId, workspace.id),
				eq(attachment.status, "ready"),
			),
		)
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, "no such attachment");

	const response = await streamObject({
		key: row.key,
		filename: row.filename,
		contentType: row.contentType,
		// `?download` forces the save dialog even for an image.
		inline: isInline(row.contentType) && !event.url.searchParams.has("download"),
	});
	if (response === null) error(404, "file missing from storage");
	return response;
}

export async function DELETE(event: RequestEvent): Promise<Response> {
	const { workspace, user } = await requireMembership(event.locals, event.params.slug);
	requirePermission(event.locals, "issues", "write");

	const rows = await db
		.select()
		.from(attachment)
		.where(and(eq(attachment.id, event.params.id), eq(attachment.workspaceId, workspace.id)))
		.limit(1);

	const row = rows[0];
	if (row === undefined) error(404, "no such attachment");
	if (row.uploadedBy !== user.id) error(403, "only the uploader can remove an attachment");

	await db.delete(attachment).where(eq(attachment.id, row.id));
	await deleteObject(row.key);

	return new Response(null, { status: 204 });
}

// Answers with bytes; not part of the documented JSON surface.
export const openapi = false;
