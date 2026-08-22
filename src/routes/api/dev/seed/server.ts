import { eq } from "drizzle-orm";
import { error } from "@implementjs/kit/server";
import { auth, devLoginEnabled } from "@/lib/server/auth.server";
import { db, schema } from "@/lib/server/db/index.server";
import { create } from "@/lib/server/issues.server";
import type { RequestEvent } from "./$types";

/**
 * Fills an empty database with something to look at: one workspace, two repos,
 * a set of issues across the default statuses, and a few comments.
 *
 * Guarded twice. `import.meta.env.DEV` is replaced with `false` in a production
 * build, so this handler's body is dead code there, and `DEV_LOGIN` has to be
 * on as well. `pnpm db:seed` is the way to call it.
 */

const DEMO_EMAIL = "demo@tracker.local";
const DEMO_PASSWORD = "demo-password-1234";

export async function POST({ request }: RequestEvent): Promise<Response> {
	if (!import.meta.env.DEV) error(404, "Not found");
	if (!devLoginEnabled) error(403, "Set DEV_LOGIN=true in .env to seed demo data");

	const [existing] = await db
		.select()
		.from(schema.workspace)
		.where(eq(schema.workspace.slug, "acme"))
		.limit(1);

	if (existing !== undefined) {
		return Response.json({
			seeded: false,
			message: "The demo workspace already exists — nothing to do.",
			workspace: existing.slug,
			login: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
		});
	}

	const userId = await ensureDemoUser(request);

	const [workspace] = await db
		.insert(schema.workspace)
		.values({
			// Negative, so it can never collide with a real GitHub owner — and so
			// `membership()` recognises it as a demo workspace.
			githubId: -1,
			slug: "acme",
			name: "Acme",
			avatarUrl: null,
			type: "Organization",
			prefix: "ACME",
		})
		.returning();

	const workspaceId = workspace!.id;

	const statuses = await db
		.insert(schema.status)
		.values([
			{ workspaceId, name: "Backlog", category: "backlog", color: "#bec2c8", position: 0 },
			{ workspaceId, name: "Todo", category: "unstarted", color: "#e2e2e2", position: 1 },
			{ workspaceId, name: "In Progress", category: "started", color: "#f2c94c", position: 2 },
			{ workspaceId, name: "In Review", category: "started", color: "#5e6ad2", position: 3 },
			{ workspaceId, name: "Done", category: "completed", color: "#5e9e6e", position: 4 },
			{ workspaceId, name: "Canceled", category: "canceled", color: "#95a2b3", position: 5 },
		])
		.returning();

	const labels = await db
		.insert(schema.label)
		.values([
			{ workspaceId, name: "Bug", color: "#eb5757" },
			{ workspaceId, name: "Feature", color: "#5e6ad2" },
			{ workspaceId, name: "Improvement", color: "#4cb782" },
			{ workspaceId, name: "Documentation", color: "#bb87fc" },
		])
		.returning();

	const repos = await db
		.insert(schema.repo)
		.values([
			{ workspaceId, githubId: -101, name: "api", description: "The public HTTP API", isPrivate: false },
			{ workspaceId, githubId: -102, name: "web", description: "Marketing site and app shell", isPrivate: false },
		])
		.returning();

	const byName = (name: string) => statuses.find((status) => status.name === name)!.id;
	const label = (name: string) => labels.find((item) => item.name === name)!.id;
	const repo = (name: string) => repos.find((item) => item.name === name)!.id;

	const seeds = [
		{
			title: "Rate limiting returns `429` without a `Retry-After` header",
			description:
				"Clients that back off correctly have nothing to back off *by*.\n\n- [x] Reproduced against staging\n- [ ] Add the header\n- [ ] Document it in the API reference\n\n```http\nHTTP/1.1 429 Too Many Requests\ncontent-type: application/json\n```",
			statusId: byName("In Progress"),
			priority: 1,
			repoId: repo("api"),
			labelIds: [label("Bug")],
		},
		{
			title: "Paginate `GET /issues` with a **cursor** rather than an offset",
			description:
				"Offsets skip rows when something is inserted mid-scan. A cursor over the sort key is stable.\n\n| Approach | Stable | Cost |\n| --- | --- | --- |\n| Offset | no | `O(n)` |\n| Cursor | yes | `O(log n)` |",
			statusId: byName("Todo"),
			priority: 2,
			repoId: repo("api"),
			labelIds: [label("Improvement")],
		},
		{
			title: "Webhook deliveries should be signed",
			description:
				"Receivers currently have no way to tell a real delivery from anything else that can reach the URL.\n\nSign `<timestamp>.<body>` with HMAC-SHA256 and send it as `X-Tracker-Signature`.",
			statusId: byName("Done"),
			priority: 2,
			repoId: repo("api"),
			labelIds: [label("Feature")],
		},
		{
			title: "Dark mode flashes light on first paint",
			description:
				"The theme is read after hydration, so the first frame is always light. Inline the theme script in `<head>` instead.",
			statusId: byName("In Review"),
			priority: 3,
			repoId: repo("web"),
			labelIds: [label("Bug")],
		},
		{
			title: "Marketing site is missing an `og:image`",
			description: "Links unfurl as a bare title everywhere. Needs a 1200×630 card.",
			statusId: byName("Backlog"),
			priority: 4,
			repoId: repo("web"),
			labelIds: [label("Improvement")],
		},
		{
			title: "Decide on a support rotation",
			description:
				"Not a code change — this one belongs to the org rather than any repo, which is what unscoped issues are for.\n\n> Two people per week, handing over on Mondays.",
			statusId: byName("Todo"),
			priority: 3,
			repoId: null,
			labelIds: [],
		},
		{
			title: "Write the API quickstart",
			description:
				"Cover minting a key, listing issues, and creating one:\n\n```sh\ncurl -H \"Authorization: Bearer trk_…\" \\\n  http://localhost:5173/api/v1/workspaces/acme/issues\n```",
			statusId: byName("Backlog"),
			priority: 4,
			repoId: null,
			labelIds: [label("Documentation")],
		},
		{
			title: "Drop support for the legacy `/v0` endpoints",
			description: "Nothing has called them in three months.",
			statusId: byName("Canceled"),
			priority: 0,
			repoId: repo("api"),
			labelIds: [],
		},
	];

	const created = [];
	for (const seed of seeds) {
		created.push(await create({ ...seed, workspaceId, creatorId: userId }));
	}

	// Explicit timestamps, spaced out: inserted in one statement they would all
	// share `now()`, and a conversation whose order depends on the planner is
	// not a conversation.
	const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

	await db.insert(schema.comment).values([
		{
			issueId: created[0]!.id,
			authorId: userId,
			body: "Confirmed against staging — the header is missing on every 429.",
			createdAt: minutesAgo(90),
		},
		{
			issueId: created[0]!.id,
			authorId: userId,
			body: "Patch is up. Waiting on a review before this moves to **In Review**.",
			createdAt: minutesAgo(20),
		},
		{
			issueId: created[3]!.id,
			authorId: userId,
			body: "Inlining the script fixes it, but it has to run before the stylesheet loads.",
			createdAt: minutesAgo(45),
		},
	]);

	return Response.json({
		seeded: true,
		workspace: "acme",
		issues: created.length,
		login: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
	});
}

/** Creates the demo account through better-auth, so the password is hashed its way. */
async function ensureDemoUser(request: Request): Promise<string> {
	const [existing] = await db
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, DEMO_EMAIL))
		.limit(1);

	if (existing !== undefined) return existing.id;

	const result = await auth.api.signUpEmail({
		body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo User" },
		headers: request.headers,
	});

	return result.user.id;
}
