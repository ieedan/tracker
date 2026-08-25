/**
 * Picking a workspace picture.
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
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ImagePlus, Loader2, X } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { GeneratedWorkspaceAvatar } from "@/lib/components/workspace-avatar";
import { imageRejectionReason } from "@/lib/domain/images";
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

/** A square you click to choose a picture, showing the current one if there is one. */
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
	label?: string;
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
		{ class: cn("flex items-center gap-3", options.class) },

		Input({
			this: input,
			type: "file",
			accept: "image/png,image/jpeg,image/gif,image/webp,image/avif",
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
				class:
					"relative size-14 shrink-0 overflow-hidden rounded-lg border border-dashed border-border p-0 hover:border-ring",
				title: "Choose a picture",
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
					Dynamic([options.seed ?? options.fallback, options.fallback], (seed, name) =>
						GeneratedWorkspaceAvatar({
							seed,
							name,
							class: "size-full rounded-none text-lg",
						}),
					),
				),

			If(
				choice.uploading,
				Div(
					{ class: "absolute inset-0 flex items-center justify-center bg-background/70" },
					Loader2({ class: "size-4 animate-spin text-muted-foreground" }),
				),
			),
		),

		Div(
			{ class: "flex flex-col items-start gap-1" },
			Button(
				{
					variant: "ghost",
					size: "sm",
					class: "h-7 gap-1.5 text-[12px] text-muted-foreground",
					disabled: choice.uploading,
					onClick: () => input.get()?.click(),
				},
				ImagePlus({ class: "size-3.5" }),
				options.label ?? "Upload a picture",
			),
			If(
				choice.preview.bind((value) => value !== ""),
				Button(
					{
						variant: "ghost",
						size: "sm",
						class: "h-6 gap-1.5 text-[11px] text-muted-foreground",
						onClick: clear,
					},
					X({ class: "size-3" }),
					"Remove",
				),
			),
		),
	);
}
