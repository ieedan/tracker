import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { db } from "@/lib/server/db.server";
import {
	requireAdminAccess,
	requireMembership,
	requirePermission,
} from "@/lib/server/guards.server";
import { label } from "@/lib/server/schema.server";
import { handler } from "./$types";

const Params = v.object({ slug: v.string(), id: v.string() });

/**
 * Deletes a label, workspace-wide.
 *
 * `labels:write`, the same scope creating uses, behind `requireAdminAccess` on
 * top. The scope was carved out so an agent working with labels need not be
 * handed repositories, teams and settings as well, and that argument covers
 * removing one as much as adding one — `workspace:write` here would have meant
 * a label-managing agent taking the whole workspace with it.
 *
 * The guard is what keeps that honest, and it is the ENG-65 webhook pattern
 * rather than a lifting of the never-admin cap. For a person it is exactly
 * `requireAdmin`: `delegatedRole` is their own role, so no human gains anything
 * they did not already have. For an agent the bot stays capped at `member` and
 * the check falls on the person who installed it, so an agent can clean up a
 * workspace's labels only where its approver could have done it by hand.
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
		const membership = requireAdminAccess(await requireMembership(locals, params.slug));
		requirePermission(locals, "labels", "write");

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
