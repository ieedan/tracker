/**
 * Browser side of an upload: reserve, PUT, confirm.
 *
 * The PUT goes straight to object storage, so the bytes never pass through the
 * app server — which is what allows a 100MB video when a serverless function
 * would cap the request body at a few megabytes.
 *
 * It uses XMLHttpRequest rather than fetch for exactly one reason: `upload.
 * onprogress`. There is no progress event for a fetch body, and a video upload
 * with no progress bar looks broken.
 */
import { signal, type Signal } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { MAX_ATTACHMENT_BYTES, formatBytes, isAllowedType } from "@/lib/domain/attachments";
import type { Attachment } from "@/lib/domain/schemas";

/** `converting` is before the bytes exist in a form the app can store. */
export type UploadStatus = "converting" | "uploading" | "done" | "error";

export interface Upload {
	/** Local id, so a row can be tracked before the server has one. */
	localId: string;
	filename: string;
	size: number;
	/** 0–100. */
	progress: Signal<number>;
	status: Signal<UploadStatus>;
	error: Signal<string>;
	/** Set once the server confirms it. */
	attachment: Signal<Attachment | null>;
}

let counter = 0;

/** A row for a file, in whatever state it is in before it goes up. */
export function newUpload(file: File, status: UploadStatus): Upload {
	counter += 1;
	return {
		localId: `upload-${counter}`,
		filename: file.name,
		size: file.size,
		progress: signal(0),
		status: signal<UploadStatus>(status),
		error: signal(""),
		attachment: signal<Attachment | null>(null),
	};
}

/** Rejects a file locally, so an impossible upload never leaves the browser. */
export function rejectionReason(file: File): string | null {
	if (file.size === 0) return "that file is empty";
	if (file.size > MAX_ATTACHMENT_BYTES) {
		return `${formatBytes(file.size)} is over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit`;
	}
	// The browser leaves `type` empty for unknown extensions.
	if (file.type === "" || !isAllowedType(file.type)) {
		return `${file.type === "" ? "that kind of file" : file.type} cannot be uploaded`;
	}
	return null;
}

export function startUpload(options: {
	file: File;
	slug: string;
	issueId?: string;
	commentId?: string;
}): Upload {
	const upload = newUpload(options.file, "uploading");

	const fail = (message: string) => {
		upload.error.set(message);
		upload.status.set("error");
	};

	const reason = rejectionReason(options.file);
	if (reason !== null) {
		fail(reason);
		return upload;
	}

	void (async () => {
		const reserved = await api.POST("/api/v1/workspaces/[slug]/attachments", {
			params: { slug: options.slug },
			body: {
				filename: options.file.name,
				contentType: options.file.type,
				size: options.file.size,
				issueId: options.issueId,
				commentId: options.commentId,
			},
		});
		if (reserved.error !== undefined) {
			fail(messageOf(reserved.error, "Could not start the upload"));
			return;
		}

		try {
			await put(reserved.data.uploadUrl, reserved.data.contentType, options.file, (fraction) =>
				upload.progress.set(Math.round(fraction * 100)),
			);
		} catch (cause) {
			fail(cause instanceof Error ? cause.message : "The upload failed");
			return;
		}

		const confirmed = await api.POST("/api/v1/workspaces/[slug]/attachments/[id]/complete", {
			params: { slug: options.slug, id: reserved.data.attachment.id },
		});
		if (confirmed.error !== undefined) {
			fail(messageOf(confirmed.error, "The upload did not finish"));
			return;
		}

		upload.attachment.set(confirmed.data);
		upload.progress.set(100);
		upload.status.set("done");
	})();

	return upload;
}

/** The PUT, with progress. Resolves on 2xx and rejects on anything else. */
function put(
	url: string,
	contentType: string,
	file: File,
	onProgress: (fraction: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("PUT", url, true);
		// The content type is inside the presigned signature; sending a different
		// one makes storage reject the request.
		request.setRequestHeader("content-type", contentType);

		request.upload.addEventListener("progress", (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total);
		});
		request.addEventListener("load", () => {
			if (request.status >= 200 && request.status < 300) resolve();
			else reject(new Error(`storage rejected the upload (${request.status})`));
		});
		request.addEventListener("error", () => reject(new Error("could not reach storage")));
		request.addEventListener("abort", () => reject(new Error("the upload was canceled")));

		request.send(file);
	});
}
