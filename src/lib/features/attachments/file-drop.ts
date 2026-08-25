/**
 * Shared attach gestures: pick, paste, and a page-wide drop overlay.
 *
 * The overlay follows shadcn-svelte-extras FileDropZone.DragOverlay: listen on
 * the window, portal a full-screen target when the drag actually carries files.
 */
import {
	Div,
	If,
	ImplementEffect,
	ImplementWindow,
	Input,
	Portal,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Paperclip, Upload } from "@implementjs/lucide";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { ALLOWED_TYPES } from "@/lib/domain/attachments";
import type { Attachment } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { rejectionReason, startUpload, type Upload as InFlight } from "./uploader";

export function filesFromList(list: FileList | File[] | null | undefined): File[] {
	if (list === null || list === undefined) return [];
	return Array.from(list);
}

export function dataTransferHasFiles(data: DataTransfer | null): boolean {
	return data?.types.includes("Files") ?? false;
}

/** Screenshots often arrive as clipboard items rather than `files`. */
export function filesFromClipboard(event: ClipboardEvent): File[] {
	const files = filesFromList(event.clipboardData?.files);
	if (files.length > 0) return files;

	const items = event.clipboardData?.items;
	if (items === undefined) return [];
	const fromItems: File[] = [];
	for (const item of items) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file !== null) fromItems.push(file);
	}
	return fromItems;
}

/** If the paste is files, attach them and keep text out of the field. */
export function preventFilePaste(event: ClipboardEvent, onFiles: (files: File[]) => void): void {
	const files = filesFromClipboard(event);
	if (files.length === 0) return;
	event.preventDefault();
	onFiles(files);
}

export function beginUploads(options: {
	files: Iterable<File>;
	slug: string;
	issueId?: string;
	commentId?: string;
	uploads: Signal<InFlight[]>;
	onUploaded: (attachment: Attachment) => void;
}): void {
	for (const file of options.files) {
		const reason = rejectionReason(file);
		if (reason !== null) {
			toastError(`${file.name}: ${reason}`);
			continue;
		}

		const upload = startUpload({
			file,
			slug: options.slug,
			issueId: options.issueId,
			commentId: options.commentId,
		});
		options.uploads.push(upload);

		upload.attachment.onChange((value) => {
			if (value === null) return;
			options.onUploaded(value);
			options.uploads.update((list) => list.filter((entry) => entry.localId !== upload.localId));
		});
	}
}

const accept = ALLOWED_TYPES.join(",");

/** Hidden file input plus a paperclip that opens it. */
export function AttachTrigger(options: {
	onFiles: (files: File[]) => void;
	class?: string;
	title?: string;
}) {
	const input = signal<HTMLInputElement | null>(null);

	return Div(
		{ class: "contents" },
		Input({
			this: input,
			type: "file",
			multiple: true,
			accept,
			class: "hidden",
			onChange: (event) => {
				options.onFiles(filesFromList(event.target.files));
				event.target.value = "";
			},
		}),
		Button(
			{
				type: "button",
				variant: "ghost",
				size: "icon-xs",
				class: cn("border border-border text-muted-foreground", options.class),
				title: options.title ?? "Attach files",
				"aria-label": options.title ?? "Attach files",
				onClick: () => input.get()?.click(),
			},
			Paperclip({ class: "size-3.5" }),
		),
	);
}

/**
 * While `enabled`, dragging files over the page covers the app with a drop
 * target. Portalled to body so a dialog cannot clip it.
 */
export function FileDragOverlay(options: {
	enabled: Readable<boolean>;
	onFiles: (files: File[]) => void;
}) {
	const depth = signal(0);
	const over = derived([depth, options.enabled], (count, on) => on && count > 0);

	const reset = () => depth.set(0);

	return Div(
		{ class: "contents" },
		ImplementEffect([options.enabled], (on) => {
			if (!on) reset();
		}),
		ImplementWindow({
			onDragenter: (event) => {
				if (!options.enabled.get()) return;
				if (!dataTransferHasFiles(event.dataTransfer)) return;
				depth.increment();
			},
			onDragleave: (event) => {
				if (!dataTransferHasFiles(event.dataTransfer)) return;
				depth.update((count) => Math.max(0, count - 1));
			},
			onDragover: (event) => {
				if (!over.get()) return;
				event.preventDefault();
			},
			onDragend: reset,
			// The overlay handles the drop; the window only clears the counter,
			// matching shadcn-svelte-extras FileDropZone.DragOverlay.
			onDrop: reset,
		}),
		If(
			over,
			Portal(
				Div(
					{
						class:
							"fixed inset-0 z-100 flex items-center justify-center bg-black/25 p-6 backdrop-blur-xs",
						onDragover: (event) => event.preventDefault(),
						onDrop: (event) => {
							event.preventDefault();
							reset();
							options.onFiles(filesFromList(event.dataTransfer?.files));
						},
					},
					Div(
						{ class: "flex flex-col items-center justify-center gap-3 text-foreground" },
						Upload({ class: "size-8", "aria-hidden": true }),
						Span({ class: "text-lg font-medium" }, "Drop files here to upload"),
					),
				),
			),
		),
	);
}
