import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { UpdateWorkspaceBody, WorkspaceSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { claimImageKey, discardImage } from "@/lib/server/images.server";
import { feedback, workspace } from "@/lib/server/schema.server";
import { toWorkspace } from "@/lib/server/serialize.server";
import { handler } from "./$types";

export const GET = handler({
	response: WorkspaceSchema,
	async handle({ locals, params }) {
		const membership = await requireMembership(locals, params.slug);
		requirePermission(locals, "workspace", "read");
		return toWorkspace(membership.workspace, membership.role);
	},
});

export const PATCH = handler({
	body: UpdateWorkspaceBody,
	response: WorkspaceSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		// `null` clears the picture, a key replaces it, absent leaves it alone —
		// which is why this is a three-way check rather than a truthiness one.
		const image =
			body.imageKey === undefined
				? undefined
				: body.imageKey === null
					? null
					: await claimImageKey(membership.user.id, body.imageKey);

		const patch = {
			...(body.name === undefined ? {} : { name: body.name }),
			...(image === undefined ? {} : { image }),
			...(body.feedbackIntake === undefined ? {} : { feedbackIntake: body.feedbackIntake }),
			...(body.feedbackBoard === undefined ? {} : { feedbackBoard: body.feedbackBoard }),
		};
		if (Object.keys(patch).length === 0) error(400, "nothing to update");

		await db
			.update(workspace)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(workspace.id, membership.workspace.id));

		// Closing the board must actually close it. Leaving already-public items
		// public would mean the switch turned off new publishing but not the page
		// people already have the link to.
		if (body.feedbackBoard === "private") {
			await db
				.update(feedback)
				.set({ visibility: "private", updatedAt: new Date() })
				.where(eq(feedback.workspaceId, membership.workspace.id));
		}

		// The object the workspace used to point at is now unreachable; drop it
		// after the row is safely updated, never before.
		if (image !== undefined && membership.workspace.image !== null) {
			await discardImage(membership.workspace.image);
		}

		return toWorkspace({ ...membership.workspace, ...patch }, membership.role);
	},
});
