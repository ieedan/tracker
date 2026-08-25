// Row shapes → the JSON the API documents. Dates become ISO strings because a
// load's return value has to survive being serialized into the page.
import type {
	Activity,
	Attachment,
	Comment,
	Feedback,
	FeedbackComment,
	Issue,
	Label,
	Member,
	Team,
	TeamRef,
	UserSummary,
	Webhook,
	WebhookDelivery,
	Workspace,
} from "@/lib/domain/schemas";
import { feedbackIdentifier } from "@/lib/domain/feedback";
import type { WorkspaceRole } from "@/lib/domain/issues";
import type * as schema from "./schema.server";

type UserRow = typeof schema.user.$inferSelect;
type IssueRow = typeof schema.issue.$inferSelect;
type LabelRow = typeof schema.label.$inferSelect;
type CommentRow = typeof schema.comment.$inferSelect;
type ActivityRow = typeof schema.issueActivity.$inferSelect;
type WorkspaceRow = typeof schema.workspace.$inferSelect;
type TeamRow = typeof schema.team.$inferSelect;
type FeedbackRow = typeof schema.feedback.$inferSelect;
type RepositoryRow = typeof schema.repository.$inferSelect;
type PullRequestRow = typeof schema.pullRequest.$inferSelect;

export const iso = (value: Date | null): string | null =>
	value === null ? null : value.toISOString();

/** The user columns every serializer needs. `type` badges bot members. */
export type UserFields = Pick<UserRow, "id" | "name" | "email" | "image" | "type" | "harness">;

export function toUser(row: UserFields): UserSummary {
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		image: row.image ?? null,
		type: row.type,
		harness: row.harness ?? null,
	};
}

export function toLabel(row: Pick<LabelRow, "id" | "name" | "color">): Label {
	return { id: row.id, name: row.name, color: row.color };
}

export function toWorkspace(row: WorkspaceRow, role: WorkspaceRole): Workspace {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		role,
		// An app URL, not a storage URL: a presigned one expires while the page
		// is still open. The route behind this mints a fresh one per request.
		image: row.image === null ? null : `/api/v1/workspaces/${row.slug}/image`,
		feedbackIntake: row.feedbackIntake,
		feedbackBoard: row.feedbackBoard,
		createdAt: row.createdAt.toISOString(),
	};
}

export function toTeam(row: TeamRow, issueCount: number): Team {
	return {
		id: row.id,
		name: row.name,
		key: row.key,
		issueCount,
		createdAt: row.createdAt.toISOString(),
	};
}

export function toTeamRef(row: Pick<TeamRow, "id" | "name" | "key">): TeamRef {
	return { id: row.id, name: row.name, key: row.key };
}

export function identifierFor(key: string, number: number): string {
	return `${key}-${number}`;
}

export function toIssue(
	row: IssueRow,
	context: {
		team: Pick<TeamRow, "id" | "name" | "key">;
		assignee: UserRow | null;
		creator: UserFields;
		labels: Array<Pick<LabelRow, "id" | "name" | "color">>;
		commentCount: number;
		/** The feedback this was converted from, when there is one. */
		feedback?: Pick<FeedbackRow, "id" | "number" | "title"> | null;
		/** The repository this issue is scoped to, when it is scoped to one. */
		repository?: Pick<RepositoryRow, "id" | "owner" | "name" | "provider"> | null;
		pullRequest?: Pick<PullRequestRow, "id" | "number" | "title" | "state" | "url"> | null;
		/** Files attached to the issue itself; omitted where none were loaded. */
		attachments?: Attachment[];
	},
): Issue {
	return {
		id: row.id,
		number: row.number,
		identifier: identifierFor(context.team.key, row.number),
		team: toTeamRef(context.team),
		title: row.title,
		description: row.description,
		status: row.status,
		priority: row.priority,
		assignee: context.assignee === null ? null : toUser(context.assignee),
		creator: toUser(context.creator),
		labels: context.labels.map(toLabel),
		commentCount: context.commentCount,
		repository:
			context.repository === undefined || context.repository === null
				? null
				: {
						id: context.repository.id,
						fullName: `${context.repository.owner}/${context.repository.name}`,
						provider: context.repository.provider,
					},
		pullRequest:
			context.pullRequest === undefined || context.pullRequest === null
				? null
				: {
						id: context.pullRequest.id,
						number: context.pullRequest.number,
						title: context.pullRequest.title,
						state: context.pullRequest.state,
						url: context.pullRequest.url,
					},
		feedback:
			context.feedback === undefined || context.feedback === null
				? null
				: {
						id: context.feedback.id,
						number: context.feedback.number,
						identifier: feedbackIdentifier(context.feedback.number),
						title: context.feedback.title,
					},
		attachments: context.attachments ?? [],
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function toComment(
	row: CommentRow,
	author: UserFields,
	attachments: Comment["attachments"] = [],
): Comment {
	return {
		id: row.id,
		body: row.body,
		author: toUser(author),
		attachments,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * A timeline entry. `data` is free-form JSON on the row, so a shape written by
 * an older build is read defensively rather than trusted.
 */
export function toActivity(row: ActivityRow, actor: UserFields): Activity {
	const parsed: unknown = JSON.parse(row.data === "" ? "{}" : row.data);
	const data = (typeof parsed === "object" && parsed !== null ? parsed : {}) as {
		from?: unknown;
		to?: unknown;
		labels?: unknown;
	};

	return {
		id: row.id,
		type: row.type,
		actor: toUser(actor),
		from: typeof data.from === "string" ? data.from : null,
		to: typeof data.to === "string" ? data.to : null,
		labels: Array.isArray(data.labels)
			? data.labels.flatMap((entry) => {
					if (typeof entry !== "object" || entry === null) return [];
					const label = entry as { name?: unknown; color?: unknown; added?: unknown };
					if (typeof label.name !== "string" || typeof label.color !== "string") return [];
					return [{ name: label.name, color: label.color, added: label.added === true }];
				})
			: [],
		createdAt: row.createdAt.toISOString(),
	};
}

export function toMember(
	row: typeof schema.workspaceMember.$inferSelect,
	user: UserFields,
): Member {
	return {
		id: row.id,
		role: row.role,
		user: toUser(user),
		createdAt: row.createdAt.toISOString(),
	};
}

type FeedbackCommentRow = typeof schema.feedbackComment.$inferSelect;

/**
 * `audience` decides what leaves the server.
 *
 * On the public board the submitter is dropped in full — not just the address.
 * Someone who writes to a feedback form has not agreed to be named on a page
 * anybody can read, and this object is serialized into that page for
 * hydration, so "the UI does not render it" is not protection.
 *
 * The converted issue goes too: that it was accepted is on the status, and the
 * issue's own title and id are the team's internal wording, not the
 * submitter's.
 */
export function toFeedback(
	row: FeedbackRow,
	context: {
		labels: Array<Pick<LabelRow, "id" | "name" | "color">>;
		submitter: UserFields | null;
		commentCount: number;
		subscriberCount: number;
		issue: { id: string; identifier: string; title: string } | null;
		audience: "member" | "public";
	},
): Feedback {
	const isPublic = context.audience === "public";
	return {
		id: row.id,
		number: row.number,
		identifier: feedbackIdentifier(row.number),
		title: row.title,
		description: row.description,
		status: row.status,
		visibility: row.visibility,
		labels: context.labels.map(toLabel),
		submitter: isPublic
			? { name: null, email: null, user: null }
			: {
					name: row.submitterName ?? context.submitter?.name ?? null,
					email: row.submitterEmail ?? context.submitter?.email ?? null,
					user: context.submitter === null ? null : toUser(context.submitter),
				},
		source: isPublic ? null : row.source,
		commentCount: context.commentCount,
		// Kept public: "how many people asked for this" is the board's whole point.
		subscriberCount: context.subscriberCount,
		issue: isPublic ? null : context.issue,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * Replying to a public thread publishes your name, which is a knowing act. It
 * does not publish your email, so that is blanked for public readers even
 * though the UI never renders it — the payload is in the page either way.
 */
export function toFeedbackComment(
	row: FeedbackCommentRow,
	author: UserFields,
	audience: "member" | "public" = "member",
): FeedbackComment {
	return {
		id: row.id,
		body: row.body,
		author: audience === "public" ? { ...toUser(author), email: "" } : toUser(author),
		internal: row.internal,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

type WebhookRow = typeof schema.webhook.$inferSelect;
type DeliveryRow = typeof schema.webhookDelivery.$inferSelect;

/** The secret is deliberately absent — it is shown once, at creation. */
export function toWebhook(
	row: WebhookRow,
	health: { lastAt: Date | null; lastStatus: string | null; failingSince: Date | null } | undefined,
): Webhook {
	return {
		id: row.id,
		url: row.url,
		description: row.description,
		events: row.events,
		// Readable, unlike the signing secret: a header is something you edit,
		// and this response is already behind admin + `webhooks:read`.
		headers: row.headers ?? {},
		filter: row.filter ?? null,
		enabled: row.enabled,
		createdAt: row.createdAt.toISOString(),
		lastDeliveryAt: iso(health?.lastAt ?? null),
		lastDeliveryStatus: (health?.lastStatus ?? null) as Webhook["lastDeliveryStatus"],
		failingSince: iso(health?.failingSince ?? null),
	};
}

export function toDelivery(row: DeliveryRow): WebhookDelivery {
	return {
		id: row.id,
		event: row.event,
		status: row.status,
		attempts: row.attempts,
		responseStatus: row.responseStatus,
		error: row.error,
		nextAttemptAt: iso(row.nextAttemptAt),
		deliveredAt: iso(row.deliveredAt),
		createdAt: row.createdAt.toISOString(),
	};
}
