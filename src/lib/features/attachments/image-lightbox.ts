/**
 * Full-size image viewer for a set of attachments. Prev/next walk only images;
 * videos and files stay out of the carousel.
 */
import {
	A,
	Div,
	If,
	Img,
	ImplementDocument,
	ImplementEffect,
	Span,
	derived,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ChevronLeftIcon, ChevronRightIcon, Download, X } from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/lib/components/ui/dialog";
import type { Attachment } from "@/lib/domain/schemas";

export function ImageLightbox(options: {
	open: Signal<boolean>;
	index: Signal<number>;
	images: Readable<Attachment[]>;
}) {
	const { open, index, images } = options;

	const current = derived([images, index], (list, i) => {
		if (list.length === 0) return null;
		return list[Math.min(Math.max(i, 0), list.length - 1)] ?? null;
	});
	const hasSeveral = images.bind((list) => list.length > 1);
	const caption = derived([index, images], (i, list) =>
		list.length === 0 ? "" : `${i + 1} of ${list.length}`,
	);

	const step = (delta: number) => {
		const list = images.get();
		if (list.length < 2) return;
		index.set((index.get() + delta + list.length) % list.length);
	};

	return Dialog(
		{ open },
		ImplementEffect([images, open, index], (list, isOpen, i) => {
			if (!isOpen) return;
			if (list.length === 0) {
				open.set(false);
				return;
			}
			if (i >= list.length) index.set(list.length - 1);
			else if (i < 0) index.set(0);
		}),
		If(
			open,
			ImplementDocument({
				onKeydown: (event) => {
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						step(-1);
					} else if (event.key === "ArrowRight") {
						event.preventDefault();
						step(1);
					}
				},
			}),
		),
		DialogContent(
			{
				// Nested dialogs scale down; a lightbox should still fill the screen.
				class:
					"w-[min(96vw,80rem)] max-w-[min(96vw,80rem)] gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,80rem)] data-[state=open]:scale-100",
				showCloseButton: false,
				overlay: { class: "bg-black/80 data-[nested]:bg-black/80" },
			},
			DialogTitle(
				{ class: "sr-only" },
				current.bind((entry) => entry?.filename ?? "Image"),
			),
			DialogDescription({ class: "sr-only" }, caption),
			Div(
				{
					class:
						"relative flex h-[min(85dvh,calc(100dvh-5.5rem))] items-center justify-center bg-black",
				},
				If(
					current,
					Img({
						src: current.bind((entry) => entry?.url ?? ""),
						alt: current.bind((entry) => entry?.filename ?? ""),
						draggable: false,
						class: "max-h-full max-w-full object-contain",
					}),
				),
				If(
					hasSeveral,
					Button(
						{
							variant: "secondary",
							size: "icon",
							class:
								"absolute top-1/2 left-3 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md",
							title: "Previous image",
							onClick: () => step(-1),
						},
						ChevronLeftIcon({ class: "size-5" }),
						Span({ class: "sr-only" }, "Previous image"),
					),
					Button(
						{
							variant: "secondary",
							size: "icon",
							class:
								"absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-full bg-background/90 shadow-md",
							title: "Next image",
							onClick: () => step(1),
						},
						ChevronRightIcon({ class: "size-5" }),
						Span({ class: "sr-only" }, "Next image"),
					),
				),
				DialogClose(
					{
						variant: "secondary",
						size: "icon",
						class: "absolute top-3 right-3 z-10 rounded-full bg-background/90 shadow-md",
					},
					X({ class: "size-4", "aria-hidden": true }),
					Span({ class: "sr-only" }, "Close"),
				),
			),
			Div(
				{ class: "flex items-center justify-between gap-3 px-4 py-2.5" },
				Span(
					{ class: "min-w-0 truncate text-[13px] text-muted-foreground" },
					current.bind((entry) => entry?.filename ?? ""),
				),
				Div(
					{ class: "flex shrink-0 items-center gap-3" },
					If(
						hasSeveral,
						Span({ class: "text-[12px] text-muted-foreground tabular-nums" }, caption),
					),
					If(
						current,
						A(
							{
								href: current.bind((entry) => (entry === null ? "#" : `${entry.url}?download`)),
								class: "text-muted-foreground hover:text-foreground",
								title: "Download",
							},
							Download({ class: "size-3.5" }),
						),
					),
				),
			),
		),
	);
}
