/**
 * Mirrors `slugify` on the server so the field can show the address a name will
 * take before anything is submitted.
 *
 * The server still has the last word: it appends `-2`, `-3`, … when the slug is
 * already taken, and it substitutes a reserved slug. This is a preview, not a
 * promise.
 */
export function slugPreview(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}
