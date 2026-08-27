/**
 * One-time backfill of `issue_subscriber` for issues that predate it.
 *
 * Going forward the write paths subscribe people as things happen; this script
 * reconstructs what those paths would have written:
 *
 *   - every issue's creator and current assignee
 *   - every comment's author
 *   - for anything a bot did, the people it plausibly did it for: workspace
 *     members holding a grant for that bot's harness. There is one bot user
 *     per harness shared by every install, so the issue row alone cannot name
 *     the exact installer — in a solo workspace this resolves to exactly the
 *     right person, and in a shared one it subscribes each member who has set
 *     that harness up (they can unsubscribe with one click).
 *
 * Idempotent: every insert goes through the same unique index the live paths
 * rely on, so running it twice writes nothing new.
 *
 *   tsx --env-file-if-exists=.env scripts/backfill-subscriptions.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/lib/server/db.server";
import {
	agentGrant,
	comment,
	issue,
	issueSubscriber,
	team,
	user,
	workspaceMember,
} from "../src/lib/server/schema.server";

async function subscribe(issueId: string, userId: string): Promise<number> {
	const result = await db
		.insert(issueSubscriber)
		.values({ id: nanoid(), issueId, userId, createdAt: new Date() })
		.onConflictDoNothing();
	return result.rowsAffected ?? 0;
}

/**
 * Members of the workspace holding a live grant for this harness — or, when the
 * bot's harness is unknown, a live grant for anything.
 */
async function installersFor(workspaceId: string, harness: string | null): Promise<string[]> {
	const rows = await db
		.selectDistinct({ userId: agentGrant.installedByUserId })
		.from(agentGrant)
		.innerJoin(
			workspaceMember,
			and(
				eq(workspaceMember.userId, agentGrant.installedByUserId),
				eq(workspaceMember.workspaceId, workspaceId),
			),
		)
		.where(
			harness === null || harness === ""
				? isNull(agentGrant.revokedAt)
				: and(isNull(agentGrant.revokedAt), eq(agentGrant.harness, harness)),
		);

	return rows.map((row) => row.userId);
}

async function main() {
	let written = 0;

	const issues = await db
		.select({
			id: issue.id,
			creatorId: issue.creatorId,
			assigneeId: issue.assigneeId,
			workspaceId: team.workspaceId,
			creatorType: user.type,
			creatorHarness: user.harness,
		})
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.innerJoin(user, eq(user.id, issue.creatorId));

	for (const row of issues) {
		written += await subscribe(row.id, row.creatorId);
		if (row.assigneeId !== null) written += await subscribe(row.id, row.assigneeId);

		if (row.creatorType === "agent") {
			for (const installer of await installersFor(row.workspaceId, row.creatorHarness)) {
				written += await subscribe(row.id, installer);
			}
		}
	}

	const comments = await db
		.select({
			issueId: comment.issueId,
			authorId: comment.authorId,
			authorType: user.type,
			authorHarness: user.harness,
			workspaceId: team.workspaceId,
		})
		.from(comment)
		.innerJoin(issue, eq(issue.id, comment.issueId))
		.innerJoin(team, eq(team.id, issue.teamId))
		.innerJoin(user, eq(user.id, comment.authorId));

	for (const row of comments) {
		written += await subscribe(row.issueId, row.authorId);
		if (row.authorType === "agent") {
			for (const installer of await installersFor(row.workspaceId, row.authorHarness)) {
				written += await subscribe(row.issueId, installer);
			}
		}
	}

	console.log(
		`Backfilled ${written} subscription(s) across ${issues.length} issue(s) and ${comments.length} comment(s).`,
	);
}

await main();
