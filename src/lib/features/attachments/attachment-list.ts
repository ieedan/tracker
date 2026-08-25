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
import { Download, FileText, Paperclip, X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { formatBytes, isAudio, isImage, isVideo } from "@/lib/domain/attachments";
import type { Attachment } from "@/lib/domain/schemas";
import { ImageLightbox } from "./image-lightbox";
import type { Upload } from "./uploader";

/** Attachments already saved, plus any still going up. */
export function AttachmentGrid(options: {
	attachments: Readable<Attachment[]>;
	uploads?: Readable<Upload[]>;
	slug: Readable<string>;
	/** Omitted on read-only views such as the public feedback board. */
	onRemove?: (attachment: Attachment) => void;
}) {
	const viewerOpen = signal(false);
	const viewerIndex = signal(0);
	const images = derived([options.attachments], (list) =>
		list.filter((attachment) => isImage(attachment.contentType)),
	);

	const openImage = (id: string) => {
		const i = images.get().findIndex((attachment) => attachment.id === id);
		if (i < 0) return;
		viewerIndex.set(i);
		viewerOpen.set(true);
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
						}),
				),
			),
		),

		ImageLightbox({ open: viewerOpen, index: viewerIndex, images }),

		options.uploads === undefined
			? null
			: ForEach(
					options.uploads,
					(upload) => upload.localId,
					(upload) => UploadRow(upload),
				),
	);
}

function AttachmentCard(
	attachment: Readable<Attachment>,
	options: {
		onRemove?: (attachment: Attachment) => void;
		onOpenImage: (id: string) => void;
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
						class:
							"absolute top-1 right-1 z-10 size-5 bg-background/80 opacity-0 backdrop-blur group-hover:opacity-100",
						title: "Remove attachment",
						onClick: (event) => {
							event.stopPropagation();
							options.onRemove?.(attachment.get());
						},
					},
					X({ class: "size-3" }),
				);

	if (isImage(current.contentType)) {
		return Div(
			{ class: "group relative overflow-hidden rounded-md border border-border" },
			removeButton,
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
