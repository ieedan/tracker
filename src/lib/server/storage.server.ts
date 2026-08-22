import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import { Client } from "minio";
import { env } from "@/lib/env.server";

/**
 * Uploads live in MinIO (S3-compatible), and the bucket is anonymously
 * readable — access control is the key being unguessable. See compose.yaml.
 */

const endpoint = new URL(env.S3_ENDPOINT);

const KEY = Symbol.for("tracker:minio");
const holder = globalThis as { [KEY]?: Client };

export const storage = (holder[KEY] ??= new Client({
	endPoint: endpoint.hostname,
	port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
	useSSL: endpoint.protocol === "https:",
	accessKey: env.S3_ACCESS_KEY,
	secretKey: env.S3_SECRET_KEY,
}));

export const BUCKET = env.S3_BUCKET;

/** 25 MiB, matching what GitHub accepts on an issue comment. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"application/pdf",
	"text/plain",
	"text/csv",
	"application/json",
	"application/zip",
	"video/mp4",
	"video/quicktime",
]);

export function isAllowedContentType(contentType: string): boolean {
	return ALLOWED_CONTENT_TYPES.has(contentType.split(";")[0]!.trim().toLowerCase());
}

/**
 * `<workspace>/<32 hex chars>/<safe filename>`. The random segment is what
 * makes the URL unguessable; the filename is kept so a download has a sensible
 * name and the extension survives.
 */
export function buildKey(workspaceId: string, filename: string): string {
	const ext = extname(filename).slice(0, 12);
	const base = filename
		.slice(0, 96)
		.replace(/[^\w.\- ]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/^-+|-+$/g, "");
	const safe = base === "" ? `file${ext}` : base;
	return `${workspaceId}/${randomBytes(16).toString("hex")}/${safe}`;
}

export async function putObject(
	key: string,
	body: Buffer,
	contentType: string,
): Promise<void> {
	await storage.putObject(BUCKET, key, body, body.byteLength, {
		"Content-Type": contentType,
		// Uploads are immutable — the key contains a fresh random segment.
		"Cache-Control": "public, max-age=31536000, immutable",
	});
}

export async function removeObject(key: string): Promise<void> {
	await storage.removeObject(BUCKET, key);
}

/** The absolute URL a browser loads the object from. */
export function publicUrl(key: string): string {
	const base = env.S3_PUBLIC_URL.replace(/\/+$/, "");
	return `${base}/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Creates the bucket if it is missing. Called once at startup by `hooks.server.ts`. */
export async function ensureBucket(): Promise<void> {
	if (await storage.bucketExists(BUCKET)) return;
	await storage.makeBucket(BUCKET);
	await storage.setBucketPolicy(
		BUCKET,
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Principal: { AWS: ["*"] },
					Action: ["s3:GetObject"],
					Resource: [`arn:aws:s3:::${BUCKET}/*`],
				},
			],
		}),
	);
}
