import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { db } from "@/lib/server/db.server";
import { requireAdmin, requireMembership, requirePermission } from "@/lib/server/guards.server";
import { label } from "@/lib/server/schema.server";
import { handler } from "./$types";

const Params = v.object({ slug: v.string(), id: v.string() });

/**
 * Deletes a label, workspace-wide.
 *
 * `workspace:write` rather than the `labels:write` that creating uses, and
 * behind `requireAdmin` on top. The label scope was carved out so an agent
 * could file a well-labelled issue without being handed the rest of the
 * workspace; letting it also satisfy this would quietly turn every credential
 * already holding it into one that can strip a label off every issue there is.
 *
 * Nothing is left behind. The three join tables — `issue_label`,
 * `feedback_label` and `issue_template_label` — cascade, so the label simply
 * stops being on the issues that carried it. Activity entries keep their own
 * JSON snapshot of the names, because the timeline is a record of what someone
 * did at the time. Webhook conditions match on the label's *name* and are
 * deliberately permissive about names that resolve to nothing, so a rule
 * mentioning a deleted label is in exactly the state it was in before the label
 * was created.
 */
export const DELETE = handler({
	params: Params,
	response: v.object({ deleted: v.boolean() }),
	async handle({ locals, params }) {
		const membership = requireAdmin(await requireMembership(locals, params.slug));
		requirePermission(locals, "workspace", "write");

		// Scoped to the workspace, so a label id from somewhere else is a 404
		// rather than a delete.
		const removed = await db
			.delete(label)
			.where(and(eq(label.workspaceId, membership.workspace.id), eq(label.id, params.id)))
			.returning({ id: label.id });

		if (removed.length === 0) error(404, "no such label");
		return { deleted: true };
	},
});
