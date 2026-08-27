/**
 * Following an issue, by hand.
 *
 * Most subscriptions are written for you — commenting on an issue, or having
 * one assigned to you, subscribes you where it happens. This is the other half:
 * following something you have not touched yet, and leaving something that has
 * gone noisy. Both directions are idempotent, so the toggle can post the state
 * it wants rather than the change it thinks it is making.
 */
import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { parseIdentifier } from "@/lib/domain/issues";
import { IssueSubscriptionSchema, SubscribeIssueBody } from "@/lib/domain/schemas";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import {
	isSubscribedToIssue,
	subscribeToIssue,
	unsubscribeFromIssue,
} from "@/lib/server/issues.server";
import { issue, team } from "@/lib/server/schema.server";
import { handler } from "./$types";

const IdentifierParams = v.object({
	slug: v.string(),
	identifier: v.string(),
});

/** The issue behind `ENG-42`, scoped to the workspace, or a 404. */
async function findIssueId(workspaceId: string, identifier: string): Promise<string> {
	const parsed = parseIdentifier(identifier);
	if (parsed === null) error(404, `"${identifier}" is not an issue identifier`);

	const rows = await db
		.select({ id: issue.id })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(
			and(
				eq(team.workspaceId, workspaceId),
				eq(team.key, parsed.key),
				eq(issue.number, parsed.number),
			),
		)
		.limit(1);

	const found = rows[0];
	if (found === undefined) error(404, `no issue ${parsed.key}-${parsed.number}`);
	return found.id;
}

/** Whether the caller is following this issue. */
export const GET = handler({
	params: IdentifierParams,
	response: IssueSubscriptionSchema,
	async handle({ locals, params }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "read");
		const issueId = await findIssueId(workspace.id, params.identifier);

		return { subscribed: await isSubscribedToIssue(issueId, user.id) };
	},
});

export const POST = handler({
	params: IdentifierParams,
	body: SubscribeIssueBody,
	response: IssueSubscriptionSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		// Reading an issue is what a subscription follows, so `read` is the scope
		// it needs — this writes nothing anyone else can see.
		requirePermission(locals, "issues", "read");
		const issueId = await findIssueId(workspace.id, params.identifier);

		if (body.subscribed) await subscribeToIssue(issueId, user.id);
		else await unsubscribeFromIssue(issueId, user.id);

		return { subscribed: body.subscribed };
	},
});
