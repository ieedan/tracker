import { error } from "@implementjs/kit/server";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json } from "@/lib/server/api.server";
import { db, schema } from "@/lib/server/db/index.server";
import {
	MAX_UPLOAD_BYTES,
	buildKey,
	isAllowedContentType,
	publicUrl,
	putObject,
} from "@/lib/server/storage.server";
import type { AttachmentDto } from "@/lib/types";
import type { RequestEvent } from "./$types";

/**
 * `multipart/form-data` with one `file` field. The bytes go to MinIO under a
 * key containing 128 bits of randomness, and the returned URL is public —
 * unguessable is the access control.
 */
export async function POST({ locals, params, request }: RequestEvent): Promise<Response> {
	const { caller, workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(400, "Expected multipart/form-data with a `file` field");
	}

	const file = form.get("file");
	if (!(file instanceof File)) error(400, "Expected a `file` field");
	if (file.size === 0) error(400, "That file is empty");
	if (file.size > MAX_UPLOAD_BYTES) {
		error(413, `Files are limited to ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
	}

	const contentType = file.type === "" ? "application/octet-stream" : file.type;
	if (!isAllowedContentType(contentType)) error(415, `${contentType} files are not accepted`);

	const key = buildKey(workspace.id, file.name);
	await putObject(key, Buffer.from(await file.arrayBuffer()), contentType);

	const [row] = await db
		.insert(schema.attachment)
		.values({
			workspaceId: workspace.id,
			key,
			filename: file.name,
			contentType,
			size: file.size,
			uploadedById: caller.id,
		})
		.returning();

	const dto: AttachmentDto = {
		id: row!.id,
		filename: row!.filename,
		contentType: row!.contentType,
		size: row!.size,
		url: publicUrl(key),
		createdAt: row!.createdAt.toISOString(),
	};

	return json(dto, { status: 201 });
}
