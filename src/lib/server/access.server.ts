import { eq } from "drizzle-orm";
import { error } from "@implementjs/kit/server";
import type { WorkspaceDto } from "@/lib/types";
import { db, schema } from "./db/index.server";
import { membership, toWorkspaceDto } from "./workspaces.server";

/** Who is making a request, once `hooks.server.ts` has worked it out. */
export type Caller = {
	id: string;
	name: string;
	image: string | null;
	githubLogin: string | null;
	/** True when the request authenticated with an API key rather than a session. */
	viaApiKey: boolean;
};

/** Reads the caller off `event.locals`, which kit seeds as `{}` before `handle` runs. */
export function callerOf(locals: App.Locals): Caller | null {
	return locals.caller ?? null;
}

/** Throws 401 unless someone is signed in. */
export function requireUser(caller: Caller | null): Caller {
	if (caller === null) error(401, "Not signed in");
	return caller;
}

/**
 * Resolves a workspace by its slug and checks the caller belongs to it.
 *
 * A workspace the caller is not a member of answers 404 rather than 403 — a
 * private organization's existence is itself something not to leak.
 */
export async function requireWorkspace(
	caller: Caller | null,
	slug: string,
): Promise<{ caller: Caller; workspace: WorkspaceDto }> {
	const user = requireUser(caller);

	const [row] = await db
		.select()
		.from(schema.workspace)
		.where(eq(schema.workspace.slug, slug))
		.limit(1);

	if (row === undefined) error(404, `No workspace named "${slug}"`);
	if (!(await membership(user.id)).has(row.id)) error(404, `No workspace named "${slug}"`);

	return { caller: user, workspace: toWorkspaceDto(row) };
}

/** Same check, by workspace id, for routes that already resolved one. */
export async function canAccess(caller: Caller | null, workspaceId: string): Promise<boolean> {
	if (caller === null) return false;
	return (await membership(caller.id)).has(workspaceId);
}
