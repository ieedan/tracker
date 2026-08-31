/**
 * Turning a picture this app cannot store into one it can.
 *
 * HEIC is what an iPhone writes, and it is on none of the allowlists here for
 * two reasons that both still hold: outside Safari a browser will not render
 * it, so an accepted upload would come back as a broken image for most of the
 * people it was shared with; and the upload goes straight to object storage
 * from the browser, so there is no point where this app's server sees the bytes
 * and could convert them.
 *
 * Which leaves the browser, before the upload starts. `createImageBitmap` hands
 * the file to whatever decoders the platform already has — on macOS and iOS
 * that includes HEIC, which is exactly where HEIC files come from — and the
 * bitmap is re-encoded as a JPEG that everything can read. Nothing is added to
 * what the server accepts: by the time an upload is reserved, the file *is* a
 * JPEG.
 *
 * A browser without a HEIC decoder (Chrome and Firefox, on any platform) throws
 * here, and the caller says so plainly. Covering those would mean shipping a
 * WASM build of libheif — a few megabytes, and LGPL — which is a decision for
 * whoever owns this app rather than something to slip into an upload path.
 */

/** What a browser might convert for us, by type and by name. */
const CONVERTIBLE_TYPES = new Set([
	"image/heic",
	"image/heif",
	"image/heic-sequence",
	"image/heif-sequence",
]);
const CONVERTIBLE_EXTENSIONS = [".heic", ".heif"];

/**
 * Offered in a file picker alongside the allowlist.
 *
 * The extensions are there because Windows and some Linux desktops hand over a
 * HEIC with an empty `type`, and a picker filtering on MIME alone would not
 * show the file at all.
 */
export const CONVERTIBLE_ACCEPT = ["image/heic", "image/heif", ".heic", ".heif"] as const;

/** Good enough that a screenshot's text stays sharp, small enough to send. */
const JPEG_QUALITY = 0.92;

/** Whether this is a picture that has to be converted before it can be stored. */
export function needsTranscode(file: File): boolean {
	const base = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
	if (CONVERTIBLE_TYPES.has(base)) return true;
	// An empty or generic type is common for HEIC off a desktop; the name is
	// then the only thing left to go on. A file that turns out not to be HEIC
	// after all still converts fine — it is decoded and re-encoded either way.
	const name = file.name.toLowerCase();
	return CONVERTIBLE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** Thrown when the platform has no decoder for the file — not a bug, a fact. */
export class UndecodableImage extends Error {}

/**
 * The same picture as a JPEG.
 *
 * Rejects with `UndecodableImage` when this browser cannot read the format,
 * which is the common case away from Apple platforms.
 */
export async function toStorableImage(file: File): Promise<File> {
	// `from-image` applies the EXIF rotation rather than leaving it as metadata
	// the JPEG would no longer carry — without it every portrait photo off a
	// phone comes out on its side.
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	} catch {
		throw new UndecodableImage(
			"this browser cannot read HEIC photos — export it as JPEG and attach that",
		);
	}

	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d");
		if (context === null) throw new UndecodableImage("this browser could not convert the photo");
		context.drawImage(bitmap, 0, 0);

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
		});
		if (blob === null) throw new UndecodableImage("this browser could not convert the photo");

		return new File([blob], jpegName(file.name), { type: "image/jpeg" });
	} finally {
		bitmap.close();
	}
}

/** `IMG_0042.HEIC` → `IMG_0042.jpeg`, since that is what it now is. */
function jpegName(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return `${dot > 0 ? filename.slice(0, dot) : filename}.jpeg`;
}
