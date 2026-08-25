import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { LinkRepositoryBody, RepositorySchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { providerFor } from "@/lib/server/providers/index.server";
import {
	listRepositories,
	reindexRepository,
	toRepository,
} from "@/lib/server/repositories.server";
import { providerInstallation, repository } from "@/lib/server/schema.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(RepositorySchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "read");
		return await listRepositories(workspace.id);
	},
});

/**
 * Links one repository the installation can see.
 *
 * Named either by the provider's id (from the picker) or by `owner/name`, since
 * the picker cannot show a repository the installation was never granted and
 * saying so explicitly is a better error than an empty list.
 *
 * Indexing runs straight after and is deliberately not awaited: a repository
 * with ten thousand files should not hold the response open, and the row's
 * index state is what the UI watches instead.
 */
export const POST = handler({
	body: LinkRepositoryBody,
	response: RepositorySchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		const installations = await db
			.select()
			.from(providerInstallation)
			.where(eq(providerInstallation.workspaceId, membership.workspace.id))
			.limit(1);

		const installation = installations[0];
		if (installation === undefined) error(409, "connect a provider before linking repositories");

		const provider = providerFor(installation.provider);
		const context = { externalId: installation.externalId };

		const remote =
			body.owner !== undefined && body.owner !== "" && body.name !== undefined && body.name !== ""
				? await provider.getRepository(context, body.owner, body.name)
				: ((await provider.listRepositories(context)).find(
						(entry) => entry.externalId === body.externalId,
					) ?? null);

		if (remote === null || remote === undefined) {
			error(404, "that repository is not visible to this connection");
		}

		const existing = await db
			.select()
			.from(repository)
			.where(
				and(
					eq(repository.workspaceId, membership.workspace.id),
					eq(repository.provider, provider.id),
					eq(repository.externalId, remote.externalId),
				),
			)
			.limit(1);

		if (existing[0] !== undefined) {
			// Already linked. Returning it beats a 409 the UI would only translate
			// back into "you already have this".
			return json(toRepository(existing[0]), { status: 200 });
		}

		const row = {
			id: nanoid(),
			workspaceId: membership.workspace.id,
			installationId: installation.id,
			provider: provider.id,
			externalId: remote.externalId,
			owner: remote.owner,
			name: remote.name,
			defaultBranch: remote.defaultBranch,
			private: remote.private,
			url: remote.url,
			description: remote.description,
			indexState: "never" as const,
			indexRef: "",
			indexedFileCount: 0,
			indexTruncated: false,
			indexedAt: null,
			indexError: "",
			createdAt: new Date(),
		};
		await db.insert(repository).values(row);

		void reindexRepository(row);
		return json(toRepository(row), { status: 201 });
	},
});
