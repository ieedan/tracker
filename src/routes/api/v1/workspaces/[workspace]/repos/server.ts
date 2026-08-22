import { asc, eq } from "drizzle-orm";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json } from "@/lib/server/api.server";
import { db, schema } from "@/lib/server/db/index.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const rows = await db
		.select()
		.from(schema.repo)
		.where(eq(schema.repo.workspaceId, workspace.id))
		.orderBy(asc(schema.repo.name));

	return json({
		items: rows.map((repo) => ({
			id: repo.id,
			name: repo.name,
			description: repo.description,
			isPrivate: repo.isPrivate,
		})),
	});
}
