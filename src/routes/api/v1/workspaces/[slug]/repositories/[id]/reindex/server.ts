import * as v from "valibot";
import { RepositorySchema } from "@/lib/domain/schemas";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import {
	reindexRepository,
	requireRepository,
	toRepository,
} from "@/lib/server/repositories.server";
import { handler } from "./$types";

/**
 * Rebuilds the file index.
 *
 * Awaited, unlike the one that runs on link: someone who pressed this button is
 * watching, and a response that returns before the work is done would show them
 * the old count.
 */
export const POST = handler({
	params: v.object({ slug: v.string(), id: v.string() }),
	response: RepositorySchema,
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "write");

		const row = await requireRepository(workspace.id, params.id);
		return toRepository(await reindexRepository(row));
	},
});
