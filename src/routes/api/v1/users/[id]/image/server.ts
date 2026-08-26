import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/server/db.server";
import { requirePermission, requireUser } from "@/lib/server/guards.server";
import { user, workspaceMember } from "@/lib/server/schema.server";
import { streamObject } from "@/lib/server/storage.server";
import type { RequestEvent } from "./$types";

const viewerMembership = alias(workspaceMember, "viewer_membership");

/**
 * Serves a person's profile picture from this server, at a stable app URL.
 *
 * Streamed rather than redirected to a presigned URL for the reasons the
 * workspace picture is — see `workspaces/[slug]/image`. An avatar earns it
 * twice over: it is rendered next to every issue, comment and member row, so a
 * storage origin the browser will not fetch from breaks the app's face
 * everywhere at once.
 *
 * Visible to anyone who shares a workspace with them, which is exactly the set
 * of people already looking at their name and avatar. A stranger gets the same
 * 404 as a user who has no picture: whether an id exists is not worth leaking.
 */
export async function GET(event: RequestEvent): Promise<Response> {
	const viewer = requireUser(event.locals);
	requirePermission(event.locals, "members", "read");

	const rows = await db
		.select({ image: user.image })
		.from(user)
		.innerJoin(workspaceMember, eq(workspaceMember.userId, user.id))
		.innerJoin(viewerMembership, eq(viewerMembership.workspaceId, workspaceMember.workspaceId))
		.where(and(eq(user.id, event.params.id), eq(viewerMembership.userId, viewer.id)))
		.limit(1);

	const image = rows[0]?.image ?? null;
	if (image === null) error(404, "this user has no picture");

	const response = await streamObject({
		key: image,
		filename: `${event.params.id}.img`,
		// No content type override — storage recorded the real one at upload.
		inline: true,
	});
	if (response === null) error(404, "picture missing from storage");
	return response;
}

/** Answers with bytes, so not part of the documented JSON surface. */
export const openapi = false;
