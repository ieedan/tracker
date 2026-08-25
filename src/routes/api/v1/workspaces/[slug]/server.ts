import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { UpdateWorkspaceBody, WorkspaceSchema } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership } from "@/lib/server/guards.server";
import { feedback, workspace } from "@/lib/server/schema.server";
import { toWorkspace } from "@/lib/server/serialize.server";
import { handler } from "./$types";

export const GET = handler({
	response: WorkspaceSchema,
	async handle({ locals, params }) {
		const membership = await requireMembership(locals, params.slug);
		return toWorkspace(membership.workspace, membership.role);
	},
});

export const PATCH = handler({
	body: UpdateWorkspaceBody,
	response: WorkspaceSchema,
	async handle({ locals, params, body }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));

		const patch = {
			...(body.name === undefined ? {} : { name: body.name }),
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

		return toWorkspace({ ...membership.workspace, ...patch }, membership.role);
	},
});
