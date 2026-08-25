/**
 * The bridge between "something happened" and the webhook queue.
 *
 * Routes call these; they never touch delivery directly. Each one awaits the
 * durable enqueue and then kicks off an opportunistic send that it deliberately
 * does not await — the response should not wait on someone else's server, and
 * the cron drain is what makes delivery reliable either way.
 */
import type { Feedback, FeedbackComment, Issue } from "@/lib/domain/schemas";
import type { WebhookEvent } from "@/lib/domain/webhooks";
import { dispatchPending, enqueue, type EventPayload } from "./webhooks.server";

type Workspace = { id: string; slug: string; name: string };
/**
 * Who did it. `type` distinguishes a person from a bot, and `onBehalfOf` names
 * the human a bot is acting for — a consumer that reacts to issue changes
 * usually wants to know which of those it is looking at.
 */
type Actor = {
	id: string;
	name: string;
	email: string;
	type?: "human" | "agent";
	onBehalfOf?: { id: string; name: string } | null;
} | null;

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

/**
 * Feedback events.
 *
 * The payload is the *member* view of the feedback, submitter address and all:
 * a webhook goes to an endpoint the workspace registered, which is the same
 * trust boundary as the workspace's own API. The public board is the only place
 * that redaction applies to.
 */
export async function emitFeedbackEvent(
	event: Extract<WebhookEvent, `feedback.${string}`>,
	context: {
		workspace: Workspace;
		actor: Actor;
		feedback: Feedback;
		/** On `feedback.updated` and `feedback.status_changed`: what moved. */
		changes?: Record<string, { from: unknown; to: unknown }>;
		/** On `feedback.converted`: the issue it became. */
		issue?: Issue;
		/** On `feedback.comment_created`: the reply. */
		comment?: FeedbackComment;
	},
): Promise<void> {
	const data: Record<string, unknown> = { feedback: context.feedback };
	if (context.changes !== undefined) data.changes = context.changes;
	if (context.issue !== undefined) data.issue = context.issue;
	if (context.comment !== undefined) data.comment = context.comment;

	await emit({ event, workspace: context.workspace, actor: context.actor, data });
}

/** Deleted feedback has no row left to read, so the payload is a summary. */
export async function emitFeedbackDeleted(context: {
	workspace: Workspace;
	actor: Actor;
	feedback: { id: string; number: number; identifier: string; title: string };
}): Promise<void> {
	await emit({
		event: "feedback.deleted",
		workspace: context.workspace,
		actor: context.actor,
		data: { feedback: context.feedback },
	});
}
