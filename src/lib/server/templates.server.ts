// Workspace-level issue templates: the saved starting points the composer can
// open on. Reads resolve every prefill — team, assignee, labels — so the
// browser can apply one without a second round of lookups.
import { error } from "@implementjs/kit/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { IssueTemplate } from "@/lib/domain/schemas";
import { db } from "./db.server";
import {
	issueTemplate,
	issueTemplateLabel,
	label,
	team,
	user,
	workspaceMember,
} from "./schema.server";
import { toLabel, toTeamRef, toUser } from "./serialize.server";

type TemplateRow = typeof issueTemplate.$inferSelect;
type TeamRow = typeof team.$inferSelect;
type UserRow = typeof user.$inferSelect;
type LabelRow = typeof label.$inferSelect;

function toTemplate(
	row: TemplateRow,
	parts: { team: TeamRow | null; assignee: UserRow | null; labels: LabelRow[] },
): IssueTemplate {
	return {
		id: row.id,
		name: row.name,
		summary: row.summary,
		title: row.title,
		description: row.description,
		team: parts.team === null ? null : toTeamRef(parts.team),
		status: row.status,
		priority: row.priority,
		assignee: parts.assignee === null ? null : toUser(parts.assignee),
		labels: parts.labels.map(toLabel),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * Attaches teams, assignees and labels to a page of template rows.
 *
 * The labels come from one extra query for the whole page rather than a join,
 * which would multiply each template row by its label count.
 */
async function hydrate(
	rows: Array<{ template: TemplateRow; team: TeamRow | null; assignee: UserRow | null }>,
): Promise<IssueTemplate[]> {
	if (rows.length === 0) return [];

	const ids = rows.map((row) => row.template.id);
	const labelRows = await db
		.select({ templateId: issueTemplateLabel.templateId, label })
		.from(issueTemplateLabel)
		.innerJoin(label, eq(label.id, issueTemplateLabel.labelId))
		.where(inArray(issueTemplateLabel.templateId, ids));

	const byTemplate = new Map<string, LabelRow[]>();
	for (const row of labelRows) {
		const list = byTemplate.get(row.templateId) ?? [];
		list.push(row.label);
		byTemplate.set(row.templateId, list);
	}

	return rows.map((row) =>
		toTemplate(row.template, {
			team: row.team,
			assignee: row.assignee,
			labels: (byTemplate.get(row.template.id) ?? []).toSorted((a, b) =>
				a.name.localeCompare(b.name),
			),
		}),
	);
}

const withJoins = () =>
	db
		.select({ template: issueTemplate, team, assignee: user })
		.from(issueTemplate)
		.leftJoin(team, eq(team.id, issueTemplate.teamId))
		.leftJoin(user, eq(user.id, issueTemplate.assigneeId));

/** Every template in the workspace, alphabetically — the order the menu shows. */
export async function listIssueTemplates(workspaceId: string): Promise<IssueTemplate[]> {
	const rows = await withJoins()
		.where(eq(issueTemplate.workspaceId, workspaceId))
		.orderBy(asc(issueTemplate.name));
	return await hydrate(rows);
}

/** One template, resolved the same way the list resolves them, or a 404. */
export async function requireIssueTemplate(
	workspaceId: string,
	id: string,
): Promise<IssueTemplate> {
	const rows = await withJoins()
		.where(and(eq(issueTemplate.workspaceId, workspaceId), eq(issueTemplate.id, id)))
		.limit(1);

	const hydrated = await hydrate(rows);
	const found = hydrated[0];
	if (found === undefined) error(404, "no such template");
	return found;
}

/**
 * Replaces a template's labels with `labelIds`, keeping only ids that name a
 * label in this workspace — a stale id is dropped rather than a 400, the same
 * way the composer drops a repository that has since been unlinked.
 */
export async function setTemplateLabels(
	workspaceId: string,
	templateId: string,
	labelIds: string[],
): Promise<void> {
	await db.delete(issueTemplateLabel).where(eq(issueTemplateLabel.templateId, templateId));
	if (labelIds.length === 0) return;

	const valid = await db
		.select({ id: label.id })
		.from(label)
		.where(and(eq(label.workspaceId, workspaceId), inArray(label.id, labelIds)));
	if (valid.length === 0) return;

	await db.insert(issueTemplateLabel).values(valid.map((row) => ({ templateId, labelId: row.id })));
}

/**
 * The user id a template may assign to, or null.
 *
 * Someone who has since left the workspace is dropped rather than kept as an
 * assignee the issue endpoint would reject at create time.
 */
export async function resolveTemplateAssignee(
	workspaceId: string,
	assigneeId: string | null,
): Promise<string | null> {
	if (assigneeId === null) return null;

	const rows = await db
		.select({ userId: workspaceMember.userId })
		.from(workspaceMember)
		.where(
			and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, assigneeId)),
		)
		.limit(1);

	return rows[0]?.userId ?? null;
}
