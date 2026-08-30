/**
 * Picking a picture — a workspace's, or your own.
 *
 * The upload runs as soon as a file is chosen rather than on submit, so the
 * form has a key in hand by the time you press the button and the wait happens
 * while you are still typing a name. The preview comes from an object URL, so
 * the image appears instantly instead of after a round trip to storage.
 */
import {
	Div,
	Dynamic,
	If,
	Img,
	Input,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ImagePlus, Loader2, X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { GeneratedWorkspaceAvatar } from "@/lib/components/workspace-avatar";
import { ALLOWED_IMAGE_TYPES, imageRejectionReason } from "@/lib/domain/images";
import { cn } from "@/lib/utils";

export interface ImageChoice {
	/** The storage key to hand back to the server, or "" for none. */
	key: Signal<string>;
	/** What to show right now: an object URL, an existing URL, or "". */
	preview: Signal<string>;
	uploading: Signal<boolean>;
}

export function imageChoice(existing: string | null = null): ImageChoice {
	return {
		key: signal(""),
		preview: signal(existing ?? ""),
		uploading: signal(false),
	};
}

/**
 * A square you click to choose a picture, showing the current one if there is
 * one.
 *
 * The tile is the whole control: no labelled button beside it saying what a
 * picture-shaped square with a dashed border already says. It answers on hover
 * instead, and the one thing hovering cannot tell you — that a picture can be
 * taken off again — sits on the tile as a corner button, and only once there is
 * a picture to remove.
 */
export function ImagePicker(options: {
	choice: ImageChoice;
	/** Name behind the generated tile shown when there is no picture. */
	fallback: Readable<string>;
	/**
	 * What the generated tile is derived from — the workspace slug, so the
	 * preview here is the tile the sidebar will show. Defaults to the name,
	 * which is all a workspace that does not exist yet has.
	 */
	seed?: Readable<string>;
	/**
	 * What the tile shows when there is no picture. Defaults to the generated
	 * workspace tile; a person's picker passes their avatar, so the empty state
	 * is what the rest of the app already shows for them.
	 */
	placeholder?: Child;
	/** Tailwind for the tile itself — a person's picture is round, not a square. */
	previewClass?: string;
	/** Called after a successful upload or a clear, for forms that save eagerly. */
	onChange?: (key: string | null) => void;
	class?: string;
}) {
	const input = signal<HTMLInputElement | null>(null);
	const { choice } = options;

	const accept = async (file: File | null) => {
		if (file === null) return;

		const reason = imageRejectionReason(file);
		if (reason !== null) {
			toastError(`${file.name}: ${reason}`);
			return;
		}

		// Shown before the bytes have gone anywhere; revoked when it is replaced.
		const objectUrl = URL.createObjectURL(file);
		const previous = choice.preview.get();
		choice.preview.set(objectUrl);
		if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);

		choice.uploading.set(true);
		const reserved = await api.POST("/api/v1/uploads/image", {
			body: { filename: file.name, contentType: file.type, size: file.size },
		});
		if (reserved.error !== undefined) {
			choice.uploading.set(false);
			choice.preview.set(previous.startsWith("blob:") ? "" : previous);
			toastError(messageOf(reserved.error, "Could not start the upload"));
			return;
		}

		const put = await fetch(reserved.data.uploadUrl, {
			method: "PUT",
			// The content type is inside the presigned signature; a different one
			// makes storage reject the request.
			headers: { "content-type": reserved.data.contentType },
			body: file,
		});
		choice.uploading.set(false);

		if (!put.ok) {
			choice.preview.set(previous.startsWith("blob:") ? "" : previous);
			toastError(`Storage rejected the upload (${put.status})`);
			return;
		}

		choice.key.set(reserved.data.key);
		options.onChange?.(reserved.data.key);
	};

	const clear = () => {
		const previous = choice.preview.get();
		if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
		choice.preview.set("");
		choice.key.set("");
		options.onChange?.(null);
	};

	return Div(
		{ class: cn("relative w-fit", options.class) },

		Input({
			this: input,
			type: "file",
			// Straight from the allowlist the server enforces, so the picker cannot
			// drift from it and offer a file that will be refused on reserve.
			accept: ALLOWED_IMAGE_TYPES.join(","),
			class: "hidden",
			onChange: (event) => {
				void accept(event.target.files?.[0] ?? null);
				// Reset, so choosing the same file twice in a row still fires.
				event.target.value = "";
			},
		}),

		Button(
			{
				variant: "ghost",
				class: cn(
					"group relative size-14 shrink-0 overflow-hidden rounded-lg border border-dashed border-border p-0 hover:border-ring",
					options.previewClass,
				),
				title: "Choose a picture",
				"aria-label": "Choose a picture",
				onClick: () => input.get()?.click(),
			},
			If(choice.preview.bind((value) => value !== ""))
				.Then(
					Img({
						src: choice.preview,
						alt: "",
						class: "size-full object-cover",
					}),
				)
				.Else(
					// The generated avatar, not a grey placeholder: this is what the
					// workspace actually looks like everywhere else until a picture
					// is uploaded, so the picker should show it rather than imply
					// there is nothing there.
					options.placeholder ??
						Dynamic([options.seed ?? options.fallback], (seed) =>
							GeneratedWorkspaceAvatar({
								seed,
								class: "size-full rounded-none text-lg",
							}),
						),
				),

			// What the label used to say, said by the tile itself and only while
			// the pointer is on it.
			Div(
				{
					class:
						"absolute inset-0 hidden items-center justify-center bg-background/70 group-hover:flex",
				},
				ImagePlus({ class: "size-4 text-muted-foreground" }),
			),

			If(
				choice.uploading,
				Div(
					{ class: "absolute inset-0 flex items-center justify-center bg-background/70" },
					Loader2({ class: "size-4 animate-spin text-muted-foreground" }),
				),
			),
		),

		// Hover is a pointer's answer only, and this screen is mostly read on a
		// phone — so an empty tile carries the same invitation permanently, in
		// the corner where the remove button will be once there is a picture.
		If(
			choice.preview.bind((value) => value === ""),
			Div(
				{
					class:
						"pointer-events-none absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground",
				},
				ImagePlus({ class: "size-3" }),
			),
		),

		// Outside the tile rather than inside it: a button cannot nest in a button.
		If(
			choice.preview.bind((value) => value !== ""),
			Button(
				{
					variant: "outline",
					size: "icon-xs",
					class: "absolute -top-1.5 -right-1.5 size-5 rounded-full p-0",
					title: "Remove the picture",
					"aria-label": "Remove the picture",
					onClick: clear,
				},
				X({ class: "size-3" }),
			),
		),
	);
}
