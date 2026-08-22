import type { Editor as TiptapEditor } from "@tiptap/core";
import {
	Button as ButtonEl,
	Div,
	Implement,
	signal,
	type Signal,
} from "@implementjs/core";
import {
	BoldIcon,
	CodeIcon,
	ImageIcon,
	ItalicIcon,
	LinkIcon,
	ListIcon,
	ListOrderedIcon,
	ListTodoIcon,
	QuoteIcon,
} from "@implementjs/lucide";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The issue and comment editor: Tiptap over ProseMirror, storing markdown.
 *
 * Everything is written to `value` as markdown, which is what the server
 * renders and what the API returns — the rich surface is only how it is typed.
 *
 * ProseMirror and its schema are most of a megabyte unminified, and the issue
 * list needs none of it, so the whole stack is imported on mount rather than
 * at module scope. That keeps it out of every chunk that merely *can* open an
 * editor — the new-issue dialog lives in the workspace layout.
 */

/** Resolved once per session; the module cache handles the rest. */
async function loadTiptap() {
	const [{ Editor }, { TaskItem, TaskList }, { TableKit }, { StarterKit }, { Markdown }] =
		await Promise.all([
			import("@tiptap/core"),
			import("@tiptap/extension-list"),
			import("@tiptap/extension-table"),
			import("@tiptap/starter-kit"),
			import("tiptap-markdown"),
		]);

	return { Editor, TaskItem, TaskList, TableKit, StarterKit, Markdown };
}

export type EditorProps = {
	/** Two-way: seeded from this, and written back on every change. */
	value: Signal<string>;
	/** Workspace slug, for uploading pasted and dropped images. */
	workspace: string;
	placeholder?: string;
	class?: string;
	/** Cmd/Ctrl+Enter, for the "submit without reaching for the mouse" path. */
	onSubmit?: () => void;
};

const TOOLBAR = [
	{ icon: BoldIcon, label: "Bold", run: (e: TiptapEditor) => e.chain().focus().toggleBold().run() },
	{ icon: ItalicIcon, label: "Italic", run: (e: TiptapEditor) => e.chain().focus().toggleItalic().run() },
	{ icon: CodeIcon, label: "Code", run: (e: TiptapEditor) => e.chain().focus().toggleCode().run() },
	{ icon: ListIcon, label: "Bullet list", run: (e: TiptapEditor) => e.chain().focus().toggleBulletList().run() },
	{ icon: ListOrderedIcon, label: "Numbered list", run: (e: TiptapEditor) => e.chain().focus().toggleOrderedList().run() },
	{ icon: ListTodoIcon, label: "Task list", run: (e: TiptapEditor) => e.chain().focus().toggleTaskList().run() },
	{ icon: QuoteIcon, label: "Quote", run: (e: TiptapEditor) => e.chain().focus().toggleBlockquote().run() },
] as const;

export function Editor(props: EditorProps) {
	const host = signal<HTMLElement | null>(null);
	const editor = signal<TiptapEditor | null>(null);
	const uploading = signal(false);

	const insertImage = async (file: File) => {
		const instance = editor.get();
		if (instance === null) return;

		uploading.set(true);
		try {
			const attachment = await api.files.upload(props.workspace, file);
			instance
				.chain()
				.focus()
				.insertContent(
					attachment.contentType.startsWith("image/")
						? { type: "image", attrs: { src: attachment.url, alt: attachment.filename } }
						: `[${attachment.filename}](${attachment.url})`,
				)
				.run();
		} catch (thrown) {
			instance
				.chain()
				.focus()
				.insertContent(`\n> Upload failed: ${thrown instanceof Error ? thrown.message : "unknown error"}\n`)
				.run();
		} finally {
			uploading.set(false);
		}
	};

	const filesFrom = (list: FileList | null | undefined): File[] =>
		list === null || list === undefined ? [] : [...list];

	return Implement.Lifecycle(
		{
			onMount: () => {
				const element = host.get();
				if (element === null) return;

				let instance: TiptapEditor | null = null;
				let unsubscribe: (() => void) | null = null;
				let disposed = false;

				void (async () => {
					const { Editor: TiptapEditorClass, TaskItem, TaskList, TableKit, StarterKit, Markdown } =
						await loadTiptap();
					if (disposed) return;

					instance = new TiptapEditorClass({
						element,
						extensions: [
							StarterKit.configure({ link: { openOnClick: false } }),
							TaskList,
							TaskItem.configure({ nested: true }),
							// Resizing writes colgroup widths that markdown cannot carry.
							TableKit.configure({ table: { resizable: false } }),
							Markdown.configure({ html: false, transformPastedText: true }),
						],
						content: props.value.get(),
						editorProps: {
							attributes: {
								class: "outline-none min-h-[inherit]",
								"data-placeholder": props.placeholder ?? "",
							},
							handlePaste: (_view, event) => {
								const files = filesFrom(event.clipboardData?.files);
								if (files.length === 0) return false;
								event.preventDefault();
								for (const file of files) void insertImage(file);
								return true;
							},
							handleDrop: (_view, event) => {
								const files = filesFrom((event as DragEvent).dataTransfer?.files);
								if (files.length === 0) return false;
								event.preventDefault();
								for (const file of files) void insertImage(file);
								return true;
							},
							handleKeyDown: (_view, event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
									props.onSubmit?.();
									return true;
								}
								return false;
							},
						},
						onUpdate: ({ editor: current }) => {
							props.value.set(current.storage.markdown.getMarkdown());
						},
					});

					editor.set(instance);

					// An external write (a reset after submitting, say) replaces the
					// document — but not while the user is the one typing into it.
					unsubscribe = props.value.onChange((next) => {
						if (instance !== null && next !== instance.storage.markdown.getMarkdown()) {
							instance.commands.setContent(next, { emitUpdate: false });
						}
					});
				})();

				return () => {
					disposed = true;
					unsubscribe?.();
					instance?.destroy();
					editor.set(null);
				};
			},
		},
		Div(
			{
				class: cn(
					"rounded-md border bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
					props.class,
				),
			},
			Div(
				{ class: "flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1" },
				...TOOLBAR.map((item) =>
					ButtonEl(
						{
							type: "button",
							title: item.label,
							"aria-label": item.label,
							class:
								"inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
							onClick: () => {
								const instance = editor.get();
								if (instance !== null) item.run(instance);
							},
						},
						item.icon({ class: "size-3.5" }),
					),
				),
				ButtonEl(
					{
						type: "button",
						title: "Insert link",
						"aria-label": "Insert link",
						class:
							"inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
						onClick: () => {
							const instance = editor.get();
							if (instance === null) return;
							const href = window.prompt("Link URL");
							if (href === null || href === "") return;
							instance.chain().focus().extendMarkRange("link").setLink({ href }).run();
						},
					},
					LinkIcon({ class: "size-3.5" }),
				),
				ButtonEl(
					{
						type: "button",
						title: "Attach a file",
						"aria-label": "Attach a file",
						class:
							"inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
						onClick: () => {
							const picker = document.createElement("input");
							picker.type = "file";
							picker.addEventListener("change", () => {
								for (const file of filesFrom(picker.files)) void insertImage(file);
							});
							picker.click();
						},
					},
					ImageIcon({ class: "size-3.5" }),
				),
				Div(
					{
						class: uploading.bind((busy) =>
							cn("ml-auto text-xs text-muted-foreground", busy ? "" : "invisible"),
						),
					},
					"Uploading…",
				),
			),
			Div({
				this: host,
				class: cn(
					"min-h-24 px-3 py-2 text-sm",
					// The editor's own prose styling, mirroring how the server renders it.
					"[&_.ProseMirror]:min-h-[inherit] [&_.ProseMirror]:outline-none",
					"[&_p]:my-1.5 [&_p:first-child]:mt-0",
					"[&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold",
					"[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold",
					"[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold",
					"[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
					"[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0",
					// Tiptap renders a task item as <li><label><input></label><div><p>…</p></div></li>,
					// so both halves need to be laid out or the box sits above its text.
					"[&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-baseline [&_li[data-type=taskItem]]:gap-2",
					"[&_li[data-type=taskItem]>label]:flex [&_li[data-type=taskItem]>label]:shrink-0 [&_li[data-type=taskItem]>label]:items-center",
					"[&_li[data-type=taskItem]>div]:min-w-0 [&_li[data-type=taskItem]>div]:flex-1",
					"[&_li[data-type=taskItem]>div>p]:my-0",
					"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
					"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
					"[&_pre]:my-2 [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3",
					"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
					"[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
					"[&_table]:my-2 [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1",
					"[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border",
					// The placeholder, drawn on the first empty paragraph.
					"[&_.ProseMirror.is-editor-empty:first-child::before]:pointer-events-none",
				),
			}),
		),
	);
}
