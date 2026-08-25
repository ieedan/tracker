/**
 * Accepting an image key that was presigned before it had an owner.
 *
 * The upload happens first — on the create-workspace form there is no workspace
 * yet — so something has to decide whether the key a request hands back is one
 * this caller is entitled to use. Two checks do it: the key carries the
 * uploader's id as an unforgeable prefix, and the object has to actually be
 * there. Together they mean you cannot point a workspace at somebody else's
 * picture, and you cannot point it at a key nothing was ever uploaded to.
 */
import { error } from "@implementjs/kit/server";
import { isAllowedImageType, MAX_IMAGE_BYTES } from "@/lib/domain/images";
import { deleteObject, headObject, ownsImageKey } from "./storage.server";

export async function claimImageKey(userId: string, key: string): Promise<string> {
	if (!ownsImageKey(userId, key)) error(403, "that image was not uploaded by you");

	const object = await headObject(key);
	if (object === null) error(400, "that image has not finished uploading");

	// Re-read from storage rather than trusting what the browser claimed at
	// presign time — this is the first point the real bytes can be measured.
	if (object.size > MAX_IMAGE_BYTES) {
		error(413, `images must be under ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
	}
	if (!isAllowedImageType(object.contentType)) {
		error(415, `${object.contentType} images cannot be used`);
	}

	return key;
}

/**
 * Removes the object a workspace used to point at.
 *
 * Best-effort and deliberately after the row is updated: an orphaned object
 * costs pennies, while deleting first and failing to save would leave a
 * workspace pointing at nothing.
 */
export async function discardImage(key: string | null): Promise<void> {
	if (key === null || key === "") return;
	await deleteObject(key);
}
