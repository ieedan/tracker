// Shared by the upload UI and the server that issues presigned URLs, so the
// browser can reject a file before asking for a URL it would not be given.

/** Anything larger is refused before a presigned URL is issued. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * What may be uploaded.
 *
 * An allowlist rather than a denylist: these files are served back to other
 * people, and `text/html` or `image/svg+xml` from an untrusted uploader is a
 * stored-XSS delivery mechanism the moment a browser renders it at the storage
 * origin. SVG is deliberately absent for that reason.
 */
export const ALLOWED_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"video/mp4",
	"video/webm",
	"video/quicktime",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
	"application/pdf",
	"application/zip",
	"text/plain",
	"text/csv",
	"application/json",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** Normalises `image/png; charset=…` before comparing. */
export function isAllowedType(contentType: string): boolean {
	const base = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
	return (ALLOWED_TYPES as readonly string[]).includes(base);
}

export const isImage = (contentType: string): boolean => contentType.startsWith("image/");
export const isVideo = (contentType: string): boolean => contentType.startsWith("video/");
export const isAudio = (contentType: string): boolean => contentType.startsWith("audio/");

/** Rendered in place rather than downloaded. */
export const isInline = (contentType: string): boolean =>
	isImage(contentType) || isVideo(contentType) || isAudio(contentType);

/** `2.4 MB` — for attachment chips. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;

	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
