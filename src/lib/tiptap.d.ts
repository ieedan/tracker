/**
 * `tiptap-markdown` ships no declaration for the storage slot it installs, so
 * `editor.storage.markdown` is invisible to TypeScript without this. The shape
 * matches the extension's runtime API.
 */
declare module "@tiptap/core" {
	interface Storage {
		markdown: {
			/** The document, serialized back to markdown. */
			getMarkdown: () => string;
		};
	}
}

export {};
