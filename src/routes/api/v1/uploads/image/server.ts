import { error } from "@implementjs/kit/server";
import * as v from "valibot";
import { MAX_IMAGE_BYTES, isAllowedImageType } from "@/lib/domain/images";
import { requireUser } from "@/lib/server/guards.server";
import { presignUpload, storageConfigured, userImageKey } from "@/lib/server/storage.server";
import { handler, json } from "./$types";

/**
 * Presigns an image upload that does not belong to anything yet.
 *
 * The workspace avatar is picked on the form that creates the workspace, so
 * there is no workspace to hang it off when the bytes go up. This is scoped to
 * the signed-in user instead, and the key it returns carries their id — see
 * `userImageKey` for why that is what makes claiming it later safe.
 */
export const POST = handler({
	body: v.object({
		filename: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
		contentType: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
		size: v.pipe(v.number(), v.integer(), v.minValue(1)),
	}),
	response: v.object({
		/** Hand this back to whatever the image is for. */
		key: v.string(),
		uploadUrl: v.string(),
		/** The exact header the PUT must send; it is inside the signature. */
		contentType: v.string(),
	}),
	async handle({ locals, body }) {
		const user = requireUser(locals);

		if (!storageConfigured()) error(503, "image storage is not configured on this server");
		if (!isAllowedImageType(body.contentType)) {
			error(415, `${body.contentType} images cannot be uploaded`);
		}
		if (body.size > MAX_IMAGE_BYTES) {
			error(413, `images must be under ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
		}

		const contentType = body.contentType.toLowerCase().split(";")[0]!.trim();
		const key = userImageKey(user.id, body.filename);
		const uploadUrl = await presignUpload({ key, contentType, size: body.size });

		return json({ key, uploadUrl, contentType }, { status: 201 });
	},
});
