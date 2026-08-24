import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { workspace, workspaceInvite } from "@/lib/server/schema.server";
import type { LoadEvent } from "./$types";

/** Shows what the link is for before asking anyone to accept it. */
export default async function load({ locals, params }: LoadEvent) {
	const rows = await db
		.select({ invite: workspaceInvite, workspace })
		.from(workspaceInvite)
		.innerJoin(workspace, eq(workspace.id, workspaceInvite.workspaceId))
		.where(eq(workspaceInvite.token, params.token))
		.limit(1);

	const row = rows[0];
	const expired =
		row !== undefined &&
		row.invite.expiresAt !== null &&
		row.invite.expiresAt.getTime() < Date.now();

	return {
		token: params.token,
		signedIn: locals.user !== null,
		invite:
			row === undefined || row.invite.revokedAt !== null || expired
				? null
				: { workspaceName: row.workspace.name, workspaceSlug: row.workspace.slug },
	};
}
