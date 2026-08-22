import { and, asc, count, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { error } from "@implementjs/kit/server";
import { between } from "@/lib/ordering";
import type {
	CommentDto,
	IssueDto,
	LabelDto,
	Paginated,
	Priority,
	RepoDto,
	StatusDto,
	UserDto,
} from "@/lib/types";
import { db, schema } from "./db/index.server";
import { publish } from "./events.server";
import { renderInlineMarkdown, renderMarkdown } from "./markdown.server";
import { dispatch } from "./webhooks.server";

/* -------------------------------------------------------------------------- */
/*                                  mapping                                   */
/* -------------------------------------------------------------------------- */

function userDto(row: typeof schema.user.$inferSelect | null): UserDto | null {
	if (row === null) return null;
	return { id: row.id, name: row.name, image: row.image, githubLogin: row.githubLogin };
}

function statusDto(row: typeof schema.status.$inferSelect): StatusDto {
	return {
		id: row.id,
		name: row.name,
		category: row.category,
		color: row.color,
		position: row.position,
	};
}

function repoDto(row: typeof schema.repo.$inferSelect | null): RepoDto | null {
	if (row === null) return null;
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		isPrivate: row.isPrivate,
	};
}

export function labelDto(row: typeof schema.label.$inferSelect): LabelDto {
	return { id: row.id, name: row.name, color: row.color, description: row.description };
}

export function commentDto(
	row: typeof schema.comment.$inferSelect,
	author: typeof schema.user.$inferSelect | null,
): CommentDto {
	return {
		id: row.id,
		body: row.body,
		bodyHtml: renderMarkdown(row.body),
		author: userDto(author),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

type IssueJoin = {
	issue: typeof schema.issue.$inferSelect;
	status: typeof schema.status.$inferSelect;
	repo: typeof schema.repo.$inferSelect | null;
	assignee: typeof schema.user.$inferSelect | null;
	creator: typeof schema.user.$inferSelect | null;
};

function issueDto(row: IssueJoin, labels: LabelDto[], commentCount: number): IssueDto {
	const issue = row.issue;
	return {
		id: issue.id,
		identifier: issue.identifier,
		number: issue.number,
		title: issue.title,
		titleHtml: renderInlineMarkdown(issue.title),
		description: issue.description,
		descriptionHtml: renderMarkdown(issue.description),
		status: statusDto(row.status),
		priority: issue.priority as Priority,
		assignee: userDto(row.assignee),
		creator: userDto(row.creator),
		repo: repoDto(row.repo),
		labels,
		position: issue.position,
		commentCount,
		createdAt: issue.createdAt.toISOString(),
		updatedAt: issue.updatedAt.toISOString(),
		completedAt: issue.completedAt?.toISOString() ?? null,
		canceledAt: issue.canceledAt?.toISOString() ?? null,
	};
}

/**
 * Both user columns are joined through aliases, so one query resolves the
 * assignee and the creator without a second round trip.
 */
const assignee = alias(schema.user, "assignee_user");
const creator = alias(schema.user, "creator_user");

/* -------------------------------------------------------------------------- */
/*                                   reads                                    */
/* -------------------------------------------------------------------------- */

export type IssueFilters = {
	statusIds?: string[];
	assigneeIds?: string[];
	labelIds?: string[];
	priorities?: number[];
	/** Repo ids; the literal `"none"` matches issues not scoped to any repo. */
	repos?: string[];
	query?: string;
	includeArchived?: boolean;
	limit?: number;
	/** The `position` of the last issue on the previous page. */
	cursor?: string;
};

/**
 * Labels and comment counts are fetched for the whole page in one query each,
 * rather than per issue, so listing N issues costs three queries, not 2N + 1.
 */
async function decorate(rows: IssueJoin[]): Promise<IssueDto[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((row) => row.issue.id);

	const [labelRows, commentRows] = await Promise.all([
		db
			.select({ issueId: schema.issueLabel.issueId, label: schema.label })
			.from(schema.issueLabel)
			.innerJoin(schema.label, eq(schema.label.id, schema.issueLabel.labelId))
			.where(inArray(schema.issueLabel.issueId, ids)),
		db
			.select({ issueId: schema.comment.issueId, total: count() })
			.from(schema.comment)
			.where(inArray(schema.comment.issueId, ids))
			.groupBy(schema.comment.issueId),
	]);

	const labelsByIssue = new Map<string, LabelDto[]>();
	for (const row of labelRows) {
		const list = labelsByIssue.get(row.issueId) ?? [];
		list.push(labelDto(row.label));
		labelsByIssue.set(row.issueId, list);
	}

	const countsByIssue = new Map(commentRows.map((row) => [row.issueId, Number(row.total)]));

	return rows.map((row) =>
		issueDto(
			row,
			(labelsByIssue.get(row.issue.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
			countsByIssue.get(row.issue.id) ?? 0,
		),
	);
}

export async function list(
	workspaceId: string,
	filters: IssueFilters = {},
): Promise<Paginated<IssueDto>> {
	const limit = Math.min(Math.max(filters.limit ?? 100, 1), 250);

	const conditions = [eq(schema.issue.workspaceId, workspaceId)];
	if (filters.includeArchived !== true) conditions.push(isNull(schema.issue.archivedAt));
	if (filters.statusIds?.length) conditions.push(inArray(schema.issue.statusId, filters.statusIds));
	if (filters.assigneeIds?.length) {
		conditions.push(inArray(schema.issue.assigneeId, filters.assigneeIds));
	}
	if (filters.priorities?.length) conditions.push(inArray(schema.issue.priority, filters.priorities));
	if (filters.repos?.length) {
		// "none" is a value alongside real ids, so "unscoped or in the api repo"
		// is expressible the same way every other dimension is.
		const ids = filters.repos.filter((id) => id !== "none");
		const branches = [
			...(ids.length > 0 ? [inArray(schema.issue.repoId, ids)] : []),
			...(filters.repos.includes("none") ? [isNull(schema.issue.repoId)] : []),
		];
		if (branches.length > 0) conditions.push(or(...branches)!);
	}
	if (filters.query !== undefined && filters.query.trim() !== "") {
		const pattern = `%${filters.query.trim()}%`;
		conditions.push(
			or(ilike(schema.issue.title, pattern), ilike(schema.issue.identifier, pattern))!,
		);
	}
	if (filters.labelIds?.length) {
		conditions.push(
			sql`exists (select 1 from ${schema.issueLabel} where ${schema.issueLabel.issueId} = ${schema.issue.id} and ${schema.issueLabel.labelId} in ${filters.labelIds})`,
		);
	}
	if (filters.cursor !== undefined) conditions.push(gt(schema.issue.position, filters.cursor));

	const rows = await db
		.select({
			issue: schema.issue,
			status: schema.status,
			repo: schema.repo,
			assignee,
			creator,
		})
		.from(schema.issue)
		.innerJoin(schema.status, eq(schema.status.id, schema.issue.statusId))
		.leftJoin(schema.repo, eq(schema.repo.id, schema.issue.repoId))
		.leftJoin(assignee, eq(assignee.id, schema.issue.assigneeId))
		.leftJoin(creator, eq(creator.id, schema.issue.creatorId))
		.where(and(...conditions))
		.orderBy(asc(schema.issue.position))
		.limit(limit + 1);

	const page = rows.slice(0, limit);
	const items = await decorate(page);

	return {
		items,
		nextCursor: rows.length > limit ? (page.at(-1)?.issue.position ?? null) : null,
	};
}

/** One issue by its human-readable identifier, with its creator resolved. */
export async function getByIdentifier(
	workspaceId: string,
	identifier: string,
): Promise<IssueDto | null> {
	const [row] = await one()
		.where(
			and(eq(schema.issue.workspaceId, workspaceId), eq(schema.issue.identifier, identifier)),
		)
		.limit(1);

	if (row === undefined) return null;
	return (await decorate([row]))[0]!;
}

export async function getById(id: string): Promise<IssueDto | null> {
	const [row] = await one().where(eq(schema.issue.id, id)).limit(1);

	if (row === undefined) return null;
	return (await decorate([row]))[0]!;
}

/** The single-issue read, shared by the two lookups above. */
function one() {
	return db
		.select({ issue: schema.issue, status: schema.status, repo: schema.repo, assignee, creator })
		.from(schema.issue)
		.innerJoin(schema.status, eq(schema.status.id, schema.issue.statusId))
		.leftJoin(schema.repo, eq(schema.repo.id, schema.issue.repoId))
		.leftJoin(assignee, eq(assignee.id, schema.issue.assigneeId))
		.leftJoin(creator, eq(creator.id, schema.issue.creatorId));
}

/**
 * The people who show up on a workspace's issues, as assignee or creator.
 *
 * Deliberately not "members": membership lives on GitHub and there is no
 * members table here, so the honest thing to offer as an assignee filter is
 * whoever has actually appeared on an issue.
 */
export async function listParticipants(workspaceId: string): Promise<UserDto[]> {
	const rows = await db
		.selectDistinct({ user: schema.user })
		.from(schema.user)
		.where(
			sql`exists (
				select 1 from ${schema.issue}
				where ${schema.issue.workspaceId} = ${workspaceId}
				  and (${schema.issue.assigneeId} = ${schema.user.id}
				    or ${schema.issue.creatorId} = ${schema.user.id})
			)`,
		);

	return rows
		.map((row) => userDto(row.user)!)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listComments(issueId: string): Promise<CommentDto[]> {
	const rows = await db
		.select({ comment: schema.comment, author: schema.user })
		.from(schema.comment)
		.leftJoin(schema.user, eq(schema.user.id, schema.comment.authorId))
		.where(eq(schema.comment.issueId, issueId))
		// Comments inserted in one statement share a timestamp, so `createdAt`
		// alone leaves their order up to the planner and it changes between reads.
		.orderBy(asc(schema.comment.createdAt), asc(schema.comment.id));

	return rows.map((row) => commentDto(row.comment, row.author));
}

/* -------------------------------------------------------------------------- */
/*                                   writes                                   */
/* -------------------------------------------------------------------------- */

/**
 * Claims the next number for a prefix. The upsert is a single statement so two
 * concurrent creates can never be handed the same number — the second one
 * blocks on the row lock and reads the incremented value.
 */
async function claimNumber(workspaceId: string, prefix: string): Promise<number> {
	const result = await db.execute<{ number: number }>(sql`
		insert into ${schema.issueCounter} (workspace_id, prefix, next)
		values (${workspaceId}, ${prefix}, 2)
		on conflict (workspace_id, prefix)
		do update set next = ${schema.issueCounter}.next + 1
		returning next - 1 as number
	`);
	return Number(result.rows[0]!.number);
}

/** The position that puts a new issue at the top of its workspace's list. */
async function topPosition(workspaceId: string): Promise<string> {
	const [first] = await db
		.select({ position: schema.issue.position })
		.from(schema.issue)
		.where(eq(schema.issue.workspaceId, workspaceId))
		.orderBy(asc(schema.issue.position))
		.limit(1);

	return between(null, first?.position ?? null);
}

export type CreateIssueInput = {
	workspaceId: string;
	title: string;
	description?: string;
	statusId?: string;
	repoId?: string | null;
	priority?: number;
	assigneeId?: string | null;
	labelIds?: string[];
	creatorId: string | null;
};

export async function create(input: CreateIssueInput): Promise<IssueDto> {
	const statuses = await db
		.select()
		.from(schema.status)
		.where(and(eq(schema.status.workspaceId, input.workspaceId), isNull(schema.status.archivedAt)))
		.orderBy(asc(schema.status.position));

	if (statuses.length === 0) error(500, "This workspace has no statuses");

	const status =
		input.statusId === undefined
			? (statuses.find((s) => s.category === "backlog") ?? statuses[0]!)
			: statuses.find((s) => s.id === input.statusId);

	if (status === undefined) error(400, "Unknown status for this workspace");

	// The prefix decides the counter: a repo-scoped issue counts under the repo
	// name, an unscoped one under the workspace prefix.
	let prefix: string;
	if (input.repoId != null) {
		const [repo] = await db
			.select()
			.from(schema.repo)
			.where(and(eq(schema.repo.id, input.repoId), eq(schema.repo.workspaceId, input.workspaceId)))
			.limit(1);
		if (repo === undefined) error(400, "Unknown repo for this workspace");
		prefix = repo.name;
	} else {
		const [workspace] = await db
			.select({ prefix: schema.workspace.prefix })
			.from(schema.workspace)
			.where(eq(schema.workspace.id, input.workspaceId))
			.limit(1);
		prefix = workspace!.prefix;
	}

	const number = await claimNumber(input.workspaceId, prefix);

	const [row] = await db
		.insert(schema.issue)
		.values({
			workspaceId: input.workspaceId,
			repoId: input.repoId ?? null,
			identifier: `${prefix}-${number}`,
			number,
			title: input.title,
			description: input.description ?? "",
			statusId: status.id,
			priority: input.priority ?? 0,
			assigneeId: input.assigneeId ?? null,
			creatorId: input.creatorId,
			position: await topPosition(input.workspaceId),
			completedAt: status.category === "completed" ? new Date() : null,
			canceledAt: status.category === "canceled" ? new Date() : null,
		})
		.returning();

	await setLabels(row!.id, input.workspaceId, input.labelIds ?? []);

	const issue = (await getById(row!.id))!;
	announce(input.workspaceId, "issue.created", { issue });
	return issue;
}

export type UpdateIssueInput = {
	title?: string;
	description?: string;
	statusId?: string;
	repoId?: string | null;
	priority?: number;
	assigneeId?: string | null;
	labelIds?: string[];
	/** Move between two issues; either end may be null. */
	move?: { after: string | null; before: string | null };
	archived?: boolean;
};

export async function update(
	workspaceId: string,
	issueId: string,
	input: UpdateIssueInput,
): Promise<IssueDto> {
	const patch: Partial<typeof schema.issue.$inferInsert> = {};

	if (input.title !== undefined) patch.title = input.title;
	if (input.description !== undefined) patch.description = input.description;
	if (input.priority !== undefined) patch.priority = input.priority;
	if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
	if (input.archived !== undefined) patch.archivedAt = input.archived ? new Date() : null;

	if (input.repoId !== undefined) {
		if (input.repoId !== null) {
			const [repo] = await db
				.select({ id: schema.repo.id })
				.from(schema.repo)
				.where(and(eq(schema.repo.id, input.repoId), eq(schema.repo.workspaceId, workspaceId)))
				.limit(1);
			if (repo === undefined) error(400, "Unknown repo for this workspace");
		}
		// The identifier deliberately does not change: links to it stay alive.
		patch.repoId = input.repoId;
	}

	if (input.statusId !== undefined) {
		const [status] = await db
			.select()
			.from(schema.status)
			.where(and(eq(schema.status.id, input.statusId), eq(schema.status.workspaceId, workspaceId)))
			.limit(1);
		if (status === undefined) error(400, "Unknown status for this workspace");

		patch.statusId = status.id;
		patch.completedAt = status.category === "completed" ? new Date() : null;
		patch.canceledAt = status.category === "canceled" ? new Date() : null;
	}

	if (input.move !== undefined) {
		patch.position = between(input.move.after, input.move.before);
	}

	if (Object.keys(patch).length > 0) {
		await db
			.update(schema.issue)
			.set(patch)
			.where(and(eq(schema.issue.id, issueId), eq(schema.issue.workspaceId, workspaceId)));
	}

	if (input.labelIds !== undefined) await setLabels(issueId, workspaceId, input.labelIds);

	const issue = await getById(issueId);
	if (issue === null) error(404, "No such issue");

	announce(workspaceId, "issue.updated", { issue });
	return issue;
}

export async function remove(workspaceId: string, issueId: string): Promise<void> {
	const deleted = await db
		.delete(schema.issue)
		.where(and(eq(schema.issue.id, issueId), eq(schema.issue.workspaceId, workspaceId)))
		.returning({ id: schema.issue.id });

	if (deleted.length === 0) error(404, "No such issue");

	publish(workspaceId, { type: "issue.deleted", issueId });
	dispatch(workspaceId, "issue.deleted", { issueId });
}

/** Replaces an issue's labels, rejecting any that belong to another workspace. */
async function setLabels(issueId: string, workspaceId: string, labelIds: string[]): Promise<void> {
	await db.delete(schema.issueLabel).where(eq(schema.issueLabel.issueId, issueId));
	if (labelIds.length === 0) return;

	const valid = await db
		.select({ id: schema.label.id })
		.from(schema.label)
		.where(and(eq(schema.label.workspaceId, workspaceId), inArray(schema.label.id, labelIds)));

	if (valid.length !== labelIds.length) error(400, "Unknown label for this workspace");

	await db
		.insert(schema.issueLabel)
		.values(valid.map((label) => ({ issueId, labelId: label.id })));
}

export async function addComment(
	workspaceId: string,
	issueId: string,
	authorId: string | null,
	body: string,
): Promise<CommentDto> {
	const [row] = await db.insert(schema.comment).values({ issueId, authorId, body }).returning();

	const author =
		authorId === null
			? null
			: ((await db.select().from(schema.user).where(eq(schema.user.id, authorId)).limit(1))[0] ??
				null);

	const dto = commentDto(row!, author);
	publish(workspaceId, { type: "comment.created", issueId, comment: dto });
	dispatch(workspaceId, "comment.created", { issueId, comment: dto });
	return dto;
}

export async function removeComment(
	workspaceId: string,
	issueId: string,
	commentId: string,
	callerId: string,
): Promise<void> {
	const [existing] = await db
		.select()
		.from(schema.comment)
		.where(and(eq(schema.comment.id, commentId), eq(schema.comment.issueId, issueId)))
		.limit(1);

	if (existing === undefined) error(404, "No such comment");
	if (existing.authorId !== callerId) error(403, "That comment belongs to someone else");

	await db.delete(schema.comment).where(eq(schema.comment.id, commentId));

	publish(workspaceId, { type: "comment.deleted", issueId, commentId });
	dispatch(workspaceId, "comment.deleted", { issueId, commentId });
}

/** Pushes to connected browsers and to registered webhooks in one call. */
function announce(
	workspaceId: string,
	event: "issue.created" | "issue.updated",
	payload: { issue: IssueDto },
): void {
	publish(workspaceId, { type: event, issue: payload.issue });
	dispatch(workspaceId, event, payload);
}
