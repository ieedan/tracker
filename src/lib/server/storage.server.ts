/**
 * Object storage for attachments.
 *
 * MinIO in development (`docker compose up -d`), Cloudflare R2 in production —
 * both speak S3, so only the endpoint and credentials differ.
 *
 * Uploads go **straight from the browser to storage** with a presigned PUT
 * rather than through this server. That is not an optimisation: a Vercel
 * function has a request body limit around 4.5MB, so proxying an upload would
 * cap attachments at roughly one phone photo. Downloads are the mirror image —
 * a short-lived presigned GET — which keeps the bucket private without this
 * server streaming every byte of every video.
 */
import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
	DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { isAllowedType, isInline } from "@/lib/domain/attachments";
import { env } from "@/lib/env.server";

export const storageConfigured = (): boolean =>
	env.S3_ENDPOINT !== "" && env.S3_BUCKET !== "" && env.S3_ACCESS_KEY_ID !== "";

let client: S3Client | null = null;

function s3(): S3Client {
	if (client !== null) return client;
	client = new S3Client({
		region: env.S3_REGION,
		endpoint: env.S3_ENDPOINT,
		credentials: {
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		},
		// MinIO and R2 both want path-style addressing; virtual-host style would
		// need per-bucket DNS.
		forcePathStyle: true,
	});
	return client;
}

/**
 * Rewrites a presigned URL onto the endpoint the browser can actually reach.
 *
 * The signature covers the path and query, not the host, so swapping the origin
 * leaves it valid. Needed when the server and the browser see storage at
 * different addresses — the app inside compose, storage beside it.
 */
function forBrowser(url: string): string {
	if (env.S3_PUBLIC_ENDPOINT === "") return url;
	const signed = new URL(url);
	const target = new URL(env.S3_PUBLIC_ENDPOINT);
	signed.protocol = target.protocol;
	signed.host = target.host;
	return signed.toString();
}

/**
 * The object key for an upload.
 *
 * Namespaced by workspace, and the stored name is a generated id rather than
 * whatever the uploader called the file — the original name is kept in the
 * database and handed back on download, so a hostile filename never reaches a
 * path. The extension rides along only to help storage-side tooling.
 */
export function attachmentKey(workspaceId: string, filename: string): string {
	const extension = /\.([a-zA-Z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase() ?? "bin";
	return `workspaces/${workspaceId}/${nanoid(21)}.${extension}`;
}

/** A URL the browser may PUT exactly this file to, for the next few minutes. */
export async function presignUpload(options: {
	key: string;
	contentType: string;
	size: number;
}): Promise<string> {
	const command = new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: options.key,
		ContentType: options.contentType,
		// Pinned into the signature: the browser cannot swap in a different type
		// or a much larger body than the one that was authorised.
		ContentLength: options.size,
	});
	return forBrowser(await getSignedUrl(s3(), command, { expiresIn: 300 }));
}

/**
 * A short-lived URL to read the object back.
 *
 * `inline` decides whether a browser renders it or downloads it — images and
 * video are shown in place, everything else is sent as an attachment so a
 * stray content type cannot execute in the storage origin.
 */
export async function presignDownload(options: {
	key: string;
	filename: string;
	contentType: string;
	inline: boolean;
}): Promise<string> {
	const disposition = options.inline ? "inline" : "attachment";
	const command = new GetObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: options.key,
		ResponseContentDisposition: `${disposition}; filename="${sanitizeFilename(options.filename)}"`,
		ResponseContentType: options.contentType,
	});
	return forBrowser(await getSignedUrl(s3(), command, { expiresIn: 900 }));
}

/** Confirms the object actually landed, and how big it really is. */
export async function headObject(
	key: string,
): Promise<{ size: number; contentType: string } | null> {
	try {
		const result = await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
		return {
			size: result.ContentLength ?? 0,
			contentType: result.ContentType ?? "application/octet-stream",
		};
	} catch {
		return null;
	}
}

export async function deleteObject(key: string): Promise<void> {
	try {
		await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	} catch {
		// A missing object is the state we wanted anyway.
	}
}

/** Quotes and control characters out; the name only ever rides in a header. */
function sanitizeFilename(filename: string): string {
	// oxlint-disable-next-line no-control-regex -- stripping control chars is the point
	return filename.replace(/[\u0000-\u001f"\\]/g, "").slice(0, 120) || "download";
}

export { isAllowedType, isInline };
