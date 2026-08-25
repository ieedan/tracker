import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { GIT_PROVIDERS } from "@/lib/domain/providers";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { providerFor } from "@/lib/server/providers/index.server";
import { providerInstallation } from "@/lib/server/schema.server";
import { handler } from "./$types";

/**
 * Where to send an admin to grant access.
 *
 * The install link is built here rather than in the browser because the App's
 * slug is server configuration, and a link that 404s on GitHub is a worse
 * outcome than a button that reports the provider is not set up.
 */
export const GET = handler({
	response: v.object({
		provider: v.nullable(v.picklist(GIT_PROVIDERS)),
		installUrl: v.nullable(v.string()),
		/** The grant already in place, if there is one. */
		connected: v.nullable(v.object({ account: v.string(), externalId: v.string() })),
	}),
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "read");

		const provider = providerFor("github");
		const rows = await db
			.select()
			.from(providerInstallation)
			.where(eq(providerInstallation.workspaceId, membership.workspace.id))
			.limit(1);

		const existing = rows[0];
		return {
			provider: provider.configured() ? provider.id : null,
			installUrl: provider.configured() ? provider.installUrl(membership.workspace.slug) : null,
			connected:
				existing === undefined
					? null
					: { account: existing.account, externalId: existing.externalId },
		};
	},
});

/**
 * Records a grant.
 *
 * Called by the callback route after the provider redirects back, and directly
 * in development where a personal token stands in for an installation.
 */
export const POST = handler({
	body: v.object({
		provider: v.optional(v.picklist(GIT_PROVIDERS), "github"),
		/** The provider's installation id. */
		externalId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
		account: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ""),
	}),
	response: v.object({ connected: v.boolean(), account: v.string() }),
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		const provider = providerFor(body.provider);
		if (!provider.configured()) error(503, `${provider.id} is not configured on this server`);

		const existing = await db
			.select()
			.from(providerInstallation)
			.where(
				and(
					eq(providerInstallation.workspaceId, membership.workspace.id),
					eq(providerInstallation.provider, body.provider),
					eq(providerInstallation.externalId, body.externalId),
				),
			)
			.limit(1);

		if (existing[0] !== undefined) {
			return { connected: true, account: existing[0].account };
		}

		await db.insert(providerInstallation).values({
			id: nanoid(),
			workspaceId: membership.workspace.id,
			provider: body.provider,
			externalId: body.externalId,
			account: body.account,
			createdBy: membership.user.id,
			createdAt: new Date(),
		});

		return { connected: true, account: body.account };
	},
});
