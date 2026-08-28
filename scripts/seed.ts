/**
 * Seeds a demo workspace so the app is worth looking at on first run.
 *
 * Users are created through better-auth rather than by inserting rows, so
 * passwords are hashed the way a real sign-up hashes them.
 *
 *   pnpm db:seed
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "../src/lib/server/auth.server";
import { db } from "../src/lib/server/db.server";
import {
	comment,
	feedback,
	feedbackComment,
	feedbackSubscriber,
	issue,
	issueLabel,
	label,
	notification,
	team,
	user,
	workspace,
	workspaceMember,
} from "../src/lib/server/schema.server";
import { DEMO_ACCOUNT } from "./lib/demo.ts";
import { DEFAULT_TEAMS } from "../src/lib/domain/issues";
import { defaultTeamLook } from "../src/lib/domain/team-icons";
import type { IssuePriority, IssueStatus } from "../src/lib/domain/issues";

const PASSWORD = DEMO_ACCOUNT.password;

// The first is the one a preview's "Sign in as…" button uses, so its address
// lives in `lib/demo.ts` where `preview-db.ts` reads it too.
const PEOPLE = [
	{ name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email },
	{ name: "Grace Hopper", email: "grace@tracker.dev" },
	{ name: "Alan Turing", email: "alan@tracker.dev" },
];

const LABELS = [
	{ name: "Bug", color: "#e5484d" },
	{ name: "Feature", color: "#3e63dd" },
	{ name: "Improvement", color: "#46a758" },
	{ name: "Design", color: "#d6409f" },
];

interface SeedIssue {
	/** Which default team files it — decides the identifier prefix. */
	team: "ENG" | "PRD";
	title: string;
	description: string;
	status: IssueStatus;
	priority: IssuePriority;
	assignee: number | null;
	labels: string[];
}

const ISSUES: SeedIssue[] = [
	{
		team: "ENG",
		title: "Command palette should remember recent issues",
		description:
			"Opening ⌘K and typing the same identifier every time is friction. Keep the last ten opened issues at the top of the list until a query is typed.",
		status: "in_progress",
		priority: "high",
		assignee: 1,
		labels: ["Improvement"],
	},
	{
		team: "ENG",
		title: "Assigning an issue does not notify the previous assignee",
		description:
			"Reassigning tells the new owner but leaves the old one thinking it is still theirs. Both sides of a reassignment should land in the inbox.",
		status: "todo",
		priority: "urgent",
		assignee: 0,
		labels: ["Bug"],
	},
	{
		team: "PRD",
		title: "Inline editing for issue titles in the list view",
		description: "Press Enter on a focused row to rename without opening the issue.",
		status: "backlog",
		priority: "medium",
		assignee: null,
		labels: ["Feature"],
	},
	{
		team: "PRD",
		title: "Dark mode contrast on label chips is too low",
		description: "The chip border disappears against the row hover state at 60% opacity.",
		status: "todo",
		priority: "low",
		assignee: 2,
		labels: ["Design", "Bug"],
	},
	{
		team: "ENG",
		title: "Paginate the issues endpoint",
		description:
			"GET /api/v1/workspaces/{slug}/issues returns every issue in the workspace. Add limit and cursor before anyone has ten thousand of them.",
		status: "backlog",
		priority: "medium",
		assignee: 1,
		labels: ["Improvement"],
	},
	{
		team: "PRD",
		title: "Webhooks for issue events",
		description: "Let a workspace register a URL that receives issue.created and issue.updated.",
		status: "backlog",
		priority: "low",
		assignee: null,
		labels: ["Feature"],
	},
	{
		team: "ENG",
		title: "Ship the public API docs",
		description: "The OpenAPI document is generated at /openapi.json; give it a rendered page.",
		status: "done",
		priority: "medium",
		assignee: 0,
		labels: ["Feature"],
	},
	{
		team: "ENG",
		title: "Drop the legacy invite-by-token endpoint",
		description: "Superseded by /api/v1/invites/{token}/accept.",
		status: "canceled",
		priority: "none",
		assignee: null,
		labels: [],
	},
];

async function ensureUser(person: { name: string; email: string }): Promise<string> {
	const existing = await db.select().from(user).where(eq(user.email, person.email)).limit(1);
	const found = existing[0];
	if (found !== undefined) return found.id;

	const result = await auth.api.signUpEmail({
		body: { name: person.name, email: person.email, password: PASSWORD },
	});
	return result.user.id;
}

async function main(): Promise<void> {
	const userIds: string[] = [];
	for (const person of PEOPLE) {
		userIds.push(await ensureUser(person));
	}
	const [ada, grace, alan] = userIds as [string, string, string];

	const slug = "acme";
	const existing = await db.select().from(workspace).where(eq(workspace.slug, slug)).limit(1);
	if (existing[0] !== undefined) {
		console.log(`Workspace "${slug}" already exists — nothing to do.`);
		console.log(`Sign in as ${PEOPLE[0]!.email} / ${PASSWORD}`);
		return;
	}

	const workspaceId = nanoid();
	await db.insert(workspace).values({
		id: workspaceId,
		name: "Acme",
		slug,
		// Open, so the demo has a public board to look at. A real workspace
		// starts closed on both counts.
		feedbackIntake: "public",
		feedbackBoard: "public",
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	// Teams own issues, and a team's key is the issue prefix.
	const teamIds = new Map<string, string>();
	for (const entry of DEFAULT_TEAMS) {
		const id = nanoid();
		teamIds.set(entry.key, id);
		await db.insert(team).values({
			id,
			workspaceId,
			name: entry.name,
			key: entry.key,
			// Same tiles a real workspace is created with, so the demo looks like
			// one rather than like two unset teams.
			...defaultTeamLook(entry.key),
			createdAt: new Date(),
		});
	}

	for (const [index, userId] of userIds.entries()) {
		await db.insert(workspaceMember).values({
			id: nanoid(),
			workspaceId,
			userId,
			// oxlint-disable-next-line implementjs/valid-role -- implement:bug:#2
			role: index === 0 ? "admin" : "member",
			createdAt: new Date(),
		});
	}

	const labelIds = new Map<string, string>();
	for (const entry of LABELS) {
		const id = nanoid();
		labelIds.set(entry.name, id);
		await db.insert(label).values({
			id,
			workspaceId,
			name: entry.name,
			color: entry.color,
			createdAt: new Date(),
		});
	}

	const issueIds: string[] = [];
	// Numbers run per team, so ENG and PRD each start at 1.
	const nextNumber = new Map<string, number>();

	for (const [index, entry] of ISSUES.entries()) {
		const id = nanoid();
		issueIds.push(id);
		// Stagger the timestamps so the list has a believable recency order.
		const when = new Date(Date.now() - (ISSUES.length - index) * 3600_000 * 7);

		const number = (nextNumber.get(entry.team) ?? 0) + 1;
		nextNumber.set(entry.team, number);

		await db.insert(issue).values({
			id,
			teamId: teamIds.get(entry.team)!,
			number,
			title: entry.title,
			description: entry.description,
			status: entry.status,
			priority: entry.priority,
			assigneeId: entry.assignee === null ? null : (userIds[entry.assignee] ?? null),
			creatorId: ada,
			createdAt: when,
			updatedAt: when,
		});

		for (const name of entry.labels) {
			const labelId = labelIds.get(name);
			if (labelId !== undefined) {
				await db.insert(issueLabel).values({ issueId: id, labelId });
			}
		}
	}

	await db.insert(comment).values([
		{
			id: nanoid(),
			issueId: issueIds[1]!,
			authorId: grace,
			body: "Reproduced — the unassign notification is written but the audience set drops it when the assignee is also the actor.",
			createdAt: new Date(Date.now() - 3600_000 * 5),
			updatedAt: new Date(Date.now() - 3600_000 * 5),
		},
		{
			id: nanoid(),
			issueId: issueIds[0]!,
			authorId: alan,
			body: "Worth storing the recents per workspace rather than globally.",
			createdAt: new Date(Date.now() - 3600_000 * 2),
			updatedAt: new Date(Date.now() - 3600_000 * 2),
		},
	]);

	// A couple of unread items so the inbox badge is not empty on first look.
	await db.insert(notification).values([
		{
			id: nanoid(),
			userId: ada,
			actorId: grace,
			workspaceId,
			issueId: issueIds[1]!,
			type: "issue_commented",
			body: "Grace Hopper commented on ENG-2",
			readAt: null,
			createdAt: new Date(Date.now() - 3600_000 * 5),
		},
		{
			id: nanoid(),
			userId: ada,
			actorId: alan,
			workspaceId,
			issueId: issueIds[0]!,
			type: "issue_status_changed",
			body: "Alan Turing moved ENG-1 to In Progress",
			readAt: null,
			createdAt: new Date(Date.now() - 3600_000 * 2),
		},
	]);

	// User feedback, in the three states worth seeing at once: something new,
	// something being looked at, and something that already became an issue.
	const feedbackRows = [
		{
			number: 1,
			title: "Dark mode is too bright at the edges",
			description:
				"The sidebar border is almost white in dark mode. On an OLED screen at night it is the only thing you can see.",
			status: "reviewing" as const,
			priority: "low" as const,
			assignee: grace,
			visibility: "public" as const,
			submitterName: "Rae Okafor",
			submitterEmail: "rae@example.com",
			source: "widget",
			ageHours: 30,
		},
		{
			number: 2,
			title: "Let me filter issues by the person who reported them",
			description: "I triage what my team filed. Right now I can only filter by assignee.",
			status: "new" as const,
			priority: "none" as const,
			assignee: null,
			visibility: "public" as const,
			submitterName: "Jules Bennet",
			submitterEmail: "jules@example.com",
			source: "widget",
			ageHours: 6,
		},
		{
			number: 3,
			title: "Our support inbox keeps losing context on escalations",
			description:
				"When we escalate a ticket the customer's original wording is gone by the time it reaches engineering.",
			status: "new" as const,
			priority: "high" as const,
			assignee: ada,
			// Named customers and account details: exactly what a private item is for.
			visibility: "private" as const,
			submitterName: "Priya Raman",
			submitterEmail: "priya@example.com",
			source: "support-inbox",
			ageHours: 3,
		},
	];

	const feedbackIds = new Map<number, string>();
	for (const row of feedbackRows) {
		const id = nanoid();
		feedbackIds.set(row.number, id);
		await db.insert(feedback).values({
			id,
			workspaceId,
			number: row.number,
			title: row.title,
			description: row.description,
			status: row.status,
			priority: row.priority,
			assigneeId: row.assignee,
			visibility: row.visibility,
			submitterName: row.submitterName,
			submitterEmail: row.submitterEmail,
			submitterUserId: null,
			source: row.source,
			createdAt: new Date(Date.now() - 3600_000 * row.ageHours),
			updatedAt: new Date(Date.now() - 3600_000 * row.ageHours),
		});
	}

	await db.insert(feedbackComment).values([
		{
			id: nanoid(),
			feedbackId: feedbackIds.get(1)!,
			authorId: grace,
			body: "Confirmed on OLED. We are going to drop the border to the same value as the background.",
			internal: false,
			createdAt: new Date(Date.now() - 3600_000 * 20),
			updatedAt: new Date(Date.now() - 3600_000 * 20),
		},
		{
			id: nanoid(),
			feedbackId: feedbackIds.get(1)!,
			body: "Third person to mention this. Worth doing before the launch.",
			authorId: alan,
			// Never reaches the public board.
			internal: true,
			createdAt: new Date(Date.now() - 3600_000 * 19),
			updatedAt: new Date(Date.now() - 3600_000 * 19),
		},
	]);

	await db.insert(feedbackSubscriber).values([
		{
			id: nanoid(),
			feedbackId: feedbackIds.get(1)!,
			email: "rae@example.com",
			userId: null,
			createdAt: new Date(Date.now() - 3600_000 * 30),
		},
		{
			id: nanoid(),
			feedbackId: feedbackIds.get(1)!,
			email: "watching@example.com",
			userId: null,
			createdAt: new Date(Date.now() - 3600_000 * 12),
		},
	]);

	console.log("Seeded the Acme workspace (teams ENG and PRD, and some feedback).");
	console.log(`Sign in as ${PEOPLE[0]!.email} / ${PASSWORD}`);
}

await main();
process.exit(0);
