/**
 * Picture uploads — a workspace's avatar today, anything else that is "an
 * image and nothing else" later.
 *
 * Separate from `attachments.ts` because the constraints are genuinely
 * different: an attachment is any file up to 100MB shown next to a comment,
 * while this is a small square rendered in the chrome on every page. A 100MB
 * PNG as a sidebar avatar would be a bad day for everyone loading the app.
 */

/** Enough for a retina avatar with room to spare; small enough to load fast. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Raster only. SVG is absent for the same reason it is absent from
 * attachments — it is a script-execution vector — and it matters more here,
 * because this image is rendered on every page rather than opened deliberately.
 */
export const ALLOWED_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
] as const;

export function isAllowedImageType(contentType: string): boolean {
	const base = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
	return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(base);
}

/** Rejects a file in the browser, so an impossible upload never leaves it. */
export function imageRejectionReason(file: File): string | null {
	if (file.size === 0) return "that file is empty";
	if (file.size > MAX_IMAGE_BYTES) {
		return `images must be under ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB`;
	}
	if (file.type === "" || !isAllowedImageType(file.type)) {
		return "that is not a PNG, JPEG, GIF, WebP or AVIF";
	}
	return null;
}
