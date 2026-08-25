import { error, redirect } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/server/db.server";
import { requireUser } from "@/lib/server/guards.server";
import { providerInstallation, workspace, workspaceMember } from "@/lib/server/schema.server";
import type { RequestEvent } from "./$types";

/**
 * Where GitHub sends the browser after the App is installed.
 *
 * The workspace comes back in `state`, which GitHub echoes from the install
 * link. That is a hint, not a credential — anyone can craft this URL — so the
 * caller's admin rights over that workspace are checked here rather than
 * assumed. Getting this wrong would let a stranger attach their installation,
 * and the repositories inside it, to somebody else's workspace.
 */
export async function GET(event: RequestEvent): Promise<Response> {
	const user = requireUser(event.locals);

	const installationId = event.url.searchParams.get("installation_id");
	const slug = event.url.searchParams.get("state") ?? "";

	// GitHub sends `setup_action=request` when the person could not install it
	// themselves and asked an owner instead. Nothing has been granted yet.
	if (event.url.searchParams.get("setup_action") === "request") {
		redirect(303, `/app/${slug}/settings?github=requested`);
	}
	if (installationId === null || installationId === "") {
		error(400, "GitHub did not send an installation id");
	}

	const rows = await db
		.select({ workspace, role: workspaceMember.role })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
		.where(and(eq(workspace.slug, slug), eq(workspaceMember.userId, user.id)))
		.limit(1);

	const membership = rows[0];
	if (membership === undefined) error(404, `no workspace "${slug}"`);
	if (membership.role !== "admin") error(403, "admin role required");

	const existing = await db
		.select({ id: providerInstallation.id })
		.from(providerInstallation)
		.where(
			and(
				eq(providerInstallation.workspaceId, membership.workspace.id),
				eq(providerInstallation.provider, "github"),
				eq(providerInstallation.externalId, installationId),
			),
		)
		.limit(1);

	if (existing[0] === undefined) {
		await db.insert(providerInstallation).values({
			id: nanoid(),
			workspaceId: membership.workspace.id,
			provider: "github",
			externalId: installationId,
			// The account name is filled in on the first successful API call; it is
			// only ever shown, so it is not worth a round trip here.
			account: event.url.searchParams.get("account") ?? "",
			createdBy: user.id,
			createdAt: new Date(),
		});
	}

	redirect(303, `/app/${slug}/settings?github=connected`);
}

/** A browser redirect target, not part of the documented JSON surface. */
export const openapi = false;
