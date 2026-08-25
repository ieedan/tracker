import { error, redirect } from "@implementjs/kit/server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { presignDownload } from "@/lib/server/storage.server";
import type { RequestEvent } from "./$types";

/**
 * Redirects to a short-lived presigned URL for the workspace picture.
 *
 * The same indirection as attachments, and for the same reason: this URL is
 * baked into the chrome on every page, so it has to outlive any credential
 * storage will issue.
 */
export async function GET(event: RequestEvent): Promise<Response> {
	const { workspace } = await requireMembership(event.locals, event.params.slug);
	requirePermission(event.locals, "workspace", "read");

	if (workspace.image === null) error(404, "this workspace has no picture");

	const url = await presignDownload({
		key: workspace.image,
		filename: `${workspace.slug}.img`,
		// No content type override — storage recorded the real one at upload, and
		// forcing a guess here is how an AVIF ends up announced as a PNG.
		inline: true,
	});
	redirect(302, url);
}

/** Answers with a redirect, so not part of the documented JSON surface. */
export const openapi = false;
