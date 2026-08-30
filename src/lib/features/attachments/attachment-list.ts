/**
 * Rendering attachments.
 *
 * Images and video are shown in place — an attachment you have to download to
 * look at is barely an attachment. Everything else is a chip with its size and
 * a download link.
 */
import {
	A,
	Div,
	ForEach,
	If,
	Img,
	Span,
	Video,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Download, FileText, Paperclip, Pencil, X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { formatBytes, isAudio, isImage, isVideo } from "@/lib/domain/attachments";
import type { Attachment } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { beginUploads } from "./file-drop";
import { ImageAnnotator } from "./image-annotator";
import { ImageLightbox } from "./image-lightbox";
import type { Upload } from "./uploader";

/** Attachments already saved, plus any still going up. */
export function AttachmentGrid(options: {
	attachments: Readable<Attachment[]>;
	uploads?: Readable<Upload[]>;
	slug: Readable<string>;
	/** Omitted on read-only views such as the public feedback board. */
	onRemove?: (attachment: Attachment) => void;
	/**
	 * ENG-84: marking up a picture. Given one, image cards offer a pencil that
	 * opens the drawing tools; the caller is handed the PNG that comes out
	 * alongside the attachment it was drawn on, and decides where it goes.
	 */
	onAnnotate?: (original: Attachment, file: File) => void;
}) {
	const viewerOpen = signal(false);
	const viewerIndex = signal(0);
	const editorOpen = signal(false);
	const editing = signal<Attachment | null>(null);
	const images = derived([options.attachments], (list) =>
		list.filter((attachment) => isImage(attachment.contentType)),
	);

	const openImage = (id: string) => {
		const i = images.get().findIndex((attachment) => attachment.id === id);
		if (i < 0) return;
		viewerIndex.set(i);
		viewerOpen.set(true);
	};

	const annotate = (attachment: Attachment) => {
		editing.set(attachment);
		editorOpen.set(true);
	};

	return Div(
		{ class: "flex flex-col gap-2" },

		If(
			options.attachments.bind((list) => list.length > 0),
			Div(
				{ class: "flex flex-wrap gap-2" },
				ForEach(
					options.attachments,
					(attachment) => attachment.id,
					(attachment) =>
						AttachmentCard(attachment, {
							onRemove: options.onRemove,
							onOpenImage: openImage,
							onAnnotate: options.onAnnotate === undefined ? undefined : annotate,
						}),
				),
			),
		),

		ImageLightbox({ open: viewerOpen, index: viewerIndex, images }),

		options.onAnnotate === undefined
			? null
			: ImageAnnotator({
					open: editorOpen,
					image: editing,
					onSave: (original, file) => options.onAnnotate?.(original, file),
				}),

		options.uploads === undefined
			? null
			: ForEach(
					options.uploads,
					(upload) => upload.localId,
					(upload) => UploadRow(upload),
				),
	);
}

/**
 * A card's actions: on the card, revealed by hovering it.
 *
 * Hover is the desktop affordance and nothing else, so a device that cannot
 * hover — every phone and tablet — is shown them outright; left to
 * `group-hover` alone they stay at `opacity: 0`, which is invisible but still
 * hit-testable, so a tap near the corner would silently press a button nobody
 * could see. Keyboard focus reveals them for the same reason.
 */
const CARD_ACTION_CLASS =
	"absolute top-1 z-10 size-5 bg-background/80 opacity-0 backdrop-blur group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

function AttachmentCard(
	attachment: Readable<Attachment>,
	options: {
		onRemove?: (attachment: Attachment) => void;
		onOpenImage: (id: string) => void;
		onAnnotate?: (attachment: Attachment) => void;
	},
) {
	const current = attachment.get();

	const removeButton =
		options.onRemove === undefined
			? null
			: Button(
					{
						size: "icon-xs",
						variant: "ghost",
						class: cn(CARD_ACTION_CLASS, "right-1"),
						title: "Remove attachment",
						onClick: (event) => {
							event.stopPropagation();
							options.onRemove?.(attachment.get());
						},
					},
					X({ class: "size-3" }),
				);

	if (isImage(current.contentType)) {
		// SVG is a document, not a bitmap: drawing on one would hand back a PNG
		// of it, which is not the file that was attached.
		const annotateButton =
			options.onAnnotate === undefined || current.contentType.startsWith("image/svg")
				? null
				: Button(
						{
							size: "icon-xs",
							variant: "ghost",
							class: cn(CARD_ACTION_CLASS, "left-1"),
							title: "Mark up this image",
							"aria-label": "Mark up this image",
							onClick: (event) => {
								event.stopPropagation();
								options.onAnnotate?.(attachment.get());
							},
						},
						Pencil({ class: "size-3" }),
					);

		return Div(
			{ class: "group relative overflow-hidden rounded-md border border-border" },
			removeButton,
			annotateButton,
			Button(
				{
					type: "button",
					variant: "ghost",
					size: "icon",
					class: "size-28 cursor-zoom-in rounded-none p-0 hover:bg-transparent",
					title: current.filename,
					"aria-haspopup": "dialog",
					onClick: () => options.onOpenImage(current.id),
				},
				Img({
					src: current.url,
					// The filename is the only description there is; better than "".
					alt: current.filename,
					// A long thread can carry a lot of these.
					loading: "lazy",
					class: "size-28 object-cover",
				}),
			),
		);
	}

	if (isVideo(current.contentType)) {
		return Div(
			{ class: "group relative overflow-hidden rounded-md border border-border" },
			removeButton,
			Video({
				src: current.url,
				controls: true,
				preload: "metadata",
				class: "h-40 max-w-sm bg-black",
			}),
		);
	}

	return Div(
		{
			class:
				"group relative flex items-center gap-2 rounded-md border border-border bg-secondary/40 py-1.5 pr-2 pl-2.5",
		},
		isAudio(current.contentType)
			? Paperclip({ class: "size-3.5 shrink-0 text-muted-foreground" })
			: FileText({ class: "size-3.5 shrink-0 text-muted-foreground" }),
		A(
			{
				href: current.url,
				target: "_blank",
				rel: "noreferrer",
				class: "max-w-[16rem] truncate text-[12px] hover:underline",
			},
			current.filename,
		),
		Span({ class: "text-[11px] text-muted-foreground" }, formatBytes(current.size)),
		A(
			{
				href: `${current.url}?download`,
				class: "text-muted-foreground hover:text-foreground",
				title: "Download",
			},
			Download({ class: "size-3.5" }),
		),
		removeButton,
	);
}

/** A file on its way up, with the progress the XHR reports. */
function UploadRow(upload: Readable<Upload>) {
	const current = upload.get();
	return Div(
		{ class: "flex flex-col gap-1 rounded-md border border-border px-2.5 py-1.5" },
		Div(
			{ class: "flex min-w-0 items-center gap-2" },
			Paperclip({ class: "size-3.5 shrink-0 text-muted-foreground" }),
			Span({ class: "min-w-0 truncate text-[12px]" }, current.filename),
			Span({ class: "shrink-0 text-[11px] text-muted-foreground" }, formatBytes(current.size)),
			If(
				current.status.bind((status) => status === "uploading"),
				Div(
					{ class: "h-1 w-24 shrink-0 overflow-hidden rounded-full bg-secondary" },
					Div({
						class: "h-full bg-primary transition-[width] duration-150",
						style: { width: current.progress.bind((value) => `${value}%`) },
					}),
				),
			),
		),
		If(
			current.status.bind((status) => status === "error"),
			Span({ class: "text-[11px] leading-snug text-destructive" }, current.error),
		),
	);
}

/**
 * Puts a marked-up copy in the place of the picture it was drawn on.
 *
 * The PNG goes up as an attachment of its own and takes the original's slot in
 * the list; the original is deleted only once the replacement is stored, so an
 * upload that fails leaves the picture exactly where it was.
 */
export function replaceWithAnnotated(options: {
	slug: string;
	original: Attachment;
	file: File;
	uploads: Signal<Upload[]>;
	list: Signal<Attachment[]>;
	/** Run once the list holds the copy — for a caller that persists a draft. */
	onReplaced?: () => void;
}): void {
	beginUploads({
		files: [options.file],
		slug: options.slug,
		uploads: options.uploads,
		onUploaded: (saved) => {
			const current = options.list.get();
			// Removed while the upload was in flight: the markup is still wanted,
			// there is just no slot left to take.
			const held = current.some((entry) => entry.id === options.original.id);
			options.list.set(
				held
					? current.map((entry) => (entry.id === options.original.id ? saved : entry))
					: [...current, saved],
			);
			options.onReplaced?.();
			void api.DELETE("/api/v1/workspaces/[slug]/attachments/[id]", {
				params: { slug: options.slug, id: options.original.id },
			});
		},
	});
}

/** Removes an attachment, rolling back if the server refuses. */
export async function removeAttachment(
	slug: string,
	attachment: Attachment,
	list: Signal<Attachment[]>,
): Promise<void> {
	const before = list.get();
	list.set(before.filter((entry) => entry.id !== attachment.id));

	const { error } = await api.DELETE("/api/v1/workspaces/[slug]/attachments/[id]", {
		params: { slug, id: attachment.id },
	});
	if (error !== undefined) {
		list.set(before);
		toastError(messageOf(error, "Could not remove the attachment"));
	}
}
