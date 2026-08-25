// Row shapes → the JSON the API documents. Dates become ISO strings because a
// load's return value has to survive being serialized into the page.
import type {
	Comment,
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
import type { WorkspaceRole } from "@/lib/domain/issues";
import type * as schema from "./schema.server";

type UserRow = typeof schema.user.$inferSelect;
type IssueRow = typeof schema.issue.$inferSelect;
type LabelRow = typeof schema.label.$inferSelect;
type CommentRow = typeof schema.comment.$inferSelect;
type WorkspaceRow = typeof schema.workspace.$inferSelect;
type TeamRow = typeof schema.team.$inferSelect;

export const iso = (value: Date | null): string | null =>
	value === null ? null : value.toISOString();

export function toUser(row: Pick<UserRow, "id" | "name" | "email" | "image">): UserSummary {
	return { id: row.id, name: row.name, email: row.email, image: row.image ?? null };
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
		creator: Pick<UserRow, "id" | "name" | "email" | "image">;
		labels: Array<Pick<LabelRow, "id" | "name" | "color">>;
		commentCount: number;
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
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function toComment(
	row: CommentRow,
	author: Pick<UserRow, "id" | "name" | "email" | "image">,
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

export function toMember(
	row: typeof schema.workspaceMember.$inferSelect,
	user: Pick<UserRow, "id" | "name" | "email" | "image">,
): Member {
	return {
		id: row.id,
		role: row.role,
		user: toUser(user),
		createdAt: row.createdAt.toISOString(),
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
