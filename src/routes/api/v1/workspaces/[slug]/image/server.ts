import { error } from "@implementjs/kit/server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { streamObject } from "@/lib/server/storage.server";
import type { RequestEvent } from "./$types";

/**
 * Serves the workspace picture from this server, at a stable app URL.
 *
 * Streamed rather than redirected to a presigned URL, and for a stronger
 * reason than attachments have: this URL is baked into the chrome on every
 * page. A redirect makes every one of those loads depend on the browser being
 * willing to fetch an image from the storage origin, and anything that says no
 * there — a content blocker, a per-site image rule, a proxy that does not know
 * about the bucket host — breaks the avatar while the rest of the app keeps
 * working. Same-origin bytes have no such second party to satisfy.
 *
 * The picture is capped at 5MB by `MAX_IMAGE_BYTES`, so this is a small
 * bounded thing to proxy, unlike the videos an attachment may hold.
 */
export async function GET(event: RequestEvent): Promise<Response> {
	const { workspace } = await requireMembership(event.locals, event.params.slug);
	requirePermission(event.locals, "workspace", "read");

	if (workspace.image === null) error(404, "this workspace has no picture");

	const response = await streamObject({
		key: workspace.image,
		filename: `${workspace.slug}.img`,
		// No content type override — storage recorded the real one at upload, and
		// forcing a guess here is how an AVIF ends up announced as a PNG.
		inline: true,
	});
	if (response === null) error(404, "picture missing from storage");
	return response;
}

/** Answers with bytes, so not part of the documented JSON surface. */
export const openapi = false;
