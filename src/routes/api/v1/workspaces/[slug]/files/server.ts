import * as v from "valibot";
import { RepositoryFileSchema } from "@/lib/domain/schemas";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { searchFiles } from "@/lib/server/repositories.server";
import { handler } from "./$types";

/**
 * What `@` autocompletes against.
 *
 * Reads the stored index rather than the provider: a keystroke-per-request
 * round trip to GitHub would be slow and would burn the installation's rate
 * limit on typing.
 */
export const GET = handler({
	query: v.object({
		q: v.optional(v.string(), ""),
		/** Narrow to the repository the issue is scoped to. */
		repository: v.optional(v.string()),
		limit: v.optional(v.pipe(v.unknown(), v.transform(Number), v.number())),
	}),
	response: v.array(RepositoryFileSchema),
	async handle({ locals, params, query }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "read");

		return await searchFiles(workspace.id, {
			query: query.q,
			repositoryId: query.repository,
			limit: Number.isFinite(query.limit) ? query.limit : undefined,
		});
	},
});
