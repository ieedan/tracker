/**
 * Mirrors `workspaceKeyFrom` on the server so the field can preview the key
 * before anything is submitted. The server still has the last word.
 */
export function workspaceKeyPreview(name: string): string {
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
	return letters.slice(0, 3).toUpperCase();
}
