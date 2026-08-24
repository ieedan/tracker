import { redirect } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { workspace, workspaceMember } from "@/lib/server/schema.server";
import type { LoadEvent } from "./$types";

/** /app is a signpost: into your first workspace, or into creating one. */
export default async function load({ locals }: LoadEvent) {
	if (locals.user === null) redirect(303, "/login");

	const rows = await db
		.select({ slug: workspace.slug })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(eq(workspaceMember.userId, locals.user.id))
		.orderBy(workspace.createdAt)
		.limit(1);

	const first = rows[0];
	redirect(303, first === undefined ? "/app/new" : `/app/${first.slug}`);
}
