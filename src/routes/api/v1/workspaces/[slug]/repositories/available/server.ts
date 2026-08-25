import { eq } from "drizzle-orm";
import * as v from "valibot";
import { AvailableRepositorySchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { providerFor } from "@/lib/server/providers/index.server";
import { linkedExternalIds } from "@/lib/server/repositories.server";
import { providerInstallation } from "@/lib/server/schema.server";
import { handler } from "./$types";

/** Everything the connection can see, marked with what is already linked. */
export const GET = handler({
	response: v.array(AvailableRepositorySchema),
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "read");

		const installations = await db
			.select()
			.from(providerInstallation)
			.where(eq(providerInstallation.workspaceId, membership.workspace.id))
			.limit(1);

		const installation = installations[0];
		if (installation === undefined) return [];

		const provider = providerFor(installation.provider);
		const linked = await linkedExternalIds(membership.workspace.id, provider.id);

		const remote = await provider.listRepositories({ externalId: installation.externalId });
		return remote.map((entry) => ({
			externalId: entry.externalId,
			owner: entry.owner,
			name: entry.name,
			fullName: `${entry.owner}/${entry.name}`,
			private: entry.private,
			description: entry.description,
			linked: linked.has(entry.externalId),
		}));
	},
});
