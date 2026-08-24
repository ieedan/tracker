/** `My Team!` → `my-team` */
export function slugify(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

/**
 * The issue prefix a workspace gets when its creator does not pick one.
 * Initials for a multi-word name, otherwise the first three letters.
 */
export function workspaceKeyFrom(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((word) => /[a-zA-Z0-9]/.test(word));
	if (words.length > 1) {
		return words
			.slice(0, 4)
			.map((word) => word[0])
			.join("")
			.toUpperCase();
	}
	const letters = name.replace(/[^a-zA-Z0-9]/g, "");
	return (letters.slice(0, 3) || "WS").toUpperCase();
}
