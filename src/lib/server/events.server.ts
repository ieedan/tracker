/**
 * The bridge between "something happened" and the webhook queue.
 *
 * Routes call these; they never touch delivery directly. Each one awaits the
 * durable enqueue and then kicks off an opportunistic send that it deliberately
 * does not await — the response should not wait on someone else's server, and
 * the cron drain is what makes delivery reliable either way.
 */
import type { Issue } from "@/lib/domain/schemas";
import type { WebhookEvent } from "@/lib/domain/webhooks";
import { dispatchPending, enqueue, type EventPayload } from "./webhooks.server";

type Workspace = { id: string; slug: string; name: string };
type Actor = { id: string; name: string; email: string } | null;

/** Enqueue, then try to send without blocking the caller. */
async function emit(payload: EventPayload): Promise<void> {
	const ids = await enqueue(payload);
	if (ids.length === 0) return;
	void dispatchPending(ids);
}

export async function emitIssueEvent(
	event: Extract<WebhookEvent, `issue.${string}`>,
	context: {
		workspace: Workspace;
		actor: Actor;
		issue: Issue;
		/** Only on `issue.updated` and friends: what actually changed. */
		changes?: Record<string, { from: unknown; to: unknown }>;
	},
): Promise<void> {
	await emit({
		event,
		workspace: context.workspace,
		actor: context.actor,
		data:
			context.changes === undefined
				? { issue: context.issue }
				: { issue: context.issue, changes: context.changes },
	});
}

export async function emitCommentEvent(context: {
	workspace: Workspace;
	actor: Actor;
	issue: Issue;
	comment: { id: string; body: string; createdAt: string };
}): Promise<void> {
	await emit({
		event: "comment.created",
		workspace: context.workspace,
		actor: context.actor,
		data: { issue: context.issue, comment: context.comment },
	});
}

/** Deleted issues have no row left to fetch, so the payload is a summary. */
export async function emitIssueDeleted(context: {
	workspace: Workspace;
	actor: Actor;
	issue: { id: string; identifier: string; title: string; team: { key: string; name: string } };
}): Promise<void> {
	await emit({
		event: "issue.deleted",
		workspace: context.workspace,
		actor: context.actor,
		data: { issue: context.issue },
	});
}
