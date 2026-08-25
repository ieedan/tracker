import { eq } from "drizzle-orm";
import * as v from "valibot";
import { RepositorySchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { requireRepository, toRepository } from "@/lib/server/repositories.server";
import { repository } from "@/lib/server/schema.server";
import { handler } from "./$types";

const Params = v.object({ slug: v.string(), id: v.string() });

export const GET = handler({
	params: Params,
	response: RepositorySchema,
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "read");
		return toRepository(await requireRepository(workspace.id, params.id));
	},
});

/**
 * Unlinks a repository. Its file index goes with it, and issues scoped to it
 * keep existing with the scope cleared — unlinking a repository is not a
 * statement about the work that referenced it.
 */
export const DELETE = handler({
	params: Params,
	response: v.object({ unlinked: v.boolean() }),
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		const row = await requireRepository(membership.workspace.id, params.id);
		await db.delete(repository).where(eq(repository.id, row.id));
		return { unlinked: true };
	},
});
