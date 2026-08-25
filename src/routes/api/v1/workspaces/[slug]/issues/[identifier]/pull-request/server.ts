import { error } from "@implementjs/kit/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { parseIdentifier } from "@/lib/domain/issues";
import { parseBareNumber, parsePullRequestRef } from "@/lib/domain/providers";
import { LinkPullRequestBody, PullRequestSchema } from "@/lib/domain/schemas";
import { recordActivity } from "@/lib/server/activity.server";
import { db } from "@/lib/server/db.server";
import { requireMembership, requirePermission } from "@/lib/server/guards.server";
import { providerFor } from "@/lib/server/providers/index.server";
import { installationFor, toPullRequest } from "@/lib/server/repositories.server";
import { issue, pullRequest, repository, team } from "@/lib/server/schema.server";
import { handler, json } from "./$types";

const Params = v.object({ slug: v.string(), identifier: v.string() });

/** The issue behind `ENG-42`, scoped to the workspace, or a 404. */
async function findIssue(workspaceId: string, identifier: string) {
	const parsed = parseIdentifier(identifier);
	if (parsed === null) error(404, `"${identifier}" is not an issue identifier`);

	const rows = await db
		.select({ issue })
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
	return found.issue;
}

export const GET = handler({
	params: Params,
	response: v.nullable(PullRequestSchema),
	async handle({ locals, params }) {
		const { workspace } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "read");

		const target = await findIssue(workspace.id, params.identifier);
		const rows = await db
			.select({ pull: pullRequest, repo: repository })
			.from(pullRequest)
			.innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
			.where(eq(pullRequest.issueId, target.id))
			.limit(1);

		const row = rows[0];
		return row === undefined ? null : toPullRequest(row.pull, row.repo);
	},
});

/**
 * Attaches a pull request to this issue, one to one.
 *
 * The reference can be a URL, `owner/name#12`, or a bare `#12` when the issue
 * is already scoped to a repository — those are the three things people
 * actually have to hand, and refusing two of them would be a papercut per link.
 *
 * The pull request is fetched before it is stored: linking to a number that
 * does not exist would leave a dead reference on the issue, and the title and
 * state have to come from somewhere anyway.
 */
export const POST = handler({
	params: Params,
	body: LinkPullRequestBody,
	response: PullRequestSchema,
	async handle({ locals, params, body }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");

		const target = await findIssue(workspace.id, params.identifier);

		const linked = await db
			.select({ id: pullRequest.id })
			.from(pullRequest)
			.where(eq(pullRequest.issueId, target.id))
			.limit(1);
		if (linked[0] !== undefined) {
			error(409, "this issue already has a pull request; unlink it first");
		}

		const { repo, number } = await resolveTarget(workspace.id, target.repositoryId, body.reference);

		const provider = providerFor(repo.provider);
		const remote = await provider.getPullRequest(
			await installationFor(repo),
			{ owner: repo.owner, name: repo.name },
			number,
		);
		if (remote === null) error(404, `no pull request #${number} in ${repo.owner}/${repo.name}`);

		// The other half of 1:1. The unique index enforces it; checking first
		// turns a constraint failure into a sentence.
		const taken = await db
			.select({ issueId: pullRequest.issueId })
			.from(pullRequest)
			.where(and(eq(pullRequest.repositoryId, repo.id), eq(pullRequest.number, number)))
			.limit(1);
		if (taken[0] !== undefined) error(409, "that pull request is already linked to another issue");

		const row = {
			id: nanoid(),
			issueId: target.id,
			repositoryId: repo.id,
			externalId: remote.externalId,
			number: remote.number,
			title: remote.title,
			state: remote.state,
			url: remote.url,
			authorLogin: remote.authorLogin,
			remoteUpdatedAt: new Date(remote.updatedAt),
			syncedAt: new Date(),
			linkedBy: user.id,
			createdAt: new Date(),
		};
		await db.insert(pullRequest).values(row);

		await recordActivity(target.id, user.id, [
			{ type: "pull_request_linked", to: `${repo.owner}/${repo.name}#${remote.number}` },
		]);

		// Linking a pull request says which repository the work is in, so an issue
		// that had not been scoped gets scoped by the act of linking.
		if (target.repositoryId === null) {
			await db.update(issue).set({ repositoryId: repo.id }).where(eq(issue.id, target.id));
		}

		return json(toPullRequest(row, repo), { status: 201 });
	},
});

export const DELETE = handler({
	params: Params,
	response: v.object({ unlinked: v.boolean() }),
	async handle({ locals, params }) {
		const { workspace, user } = await requireMembership(locals, params.slug);
		requirePermission(locals, "issues", "write");

		const target = await findIssue(workspace.id, params.identifier);
		const removed = await db
			.delete(pullRequest)
			.where(eq(pullRequest.issueId, target.id))
			.returning({ number: pullRequest.number });

		const gone = removed[0];
		if (gone !== undefined) {
			await recordActivity(target.id, user.id, [
				{ type: "pull_request_unlinked", from: `#${gone.number}` },
			]);
		}
		return { unlinked: true };
	},
});

/** Works out which repository and number a reference names. */
async function resolveTarget(
	workspaceId: string,
	scopedRepositoryId: string | null,
	reference: string,
): Promise<{ repo: typeof repository.$inferSelect; number: number }> {
	const full = parsePullRequestRef(reference);
	if (full !== null) {
		const rows = await db
			.select()
			.from(repository)
			.where(
				and(
					eq(repository.workspaceId, workspaceId),
					eq(repository.owner, full.owner),
					eq(repository.name, full.name),
				),
			)
			.limit(1);

		const repo = rows[0];
		if (repo === undefined) {
			error(400, `${full.owner}/${full.name} is not linked to this workspace`);
		}
		return { repo, number: full.number };
	}

	const bare = parseBareNumber(reference);
	if (bare === null) {
		error(400, "use a pull request URL, owner/name#12, or #12");
	}
	if (scopedRepositoryId === null) {
		error(400, "scope this issue to a repository first, or paste the full pull request URL");
	}

	const rows = await db
		.select()
		.from(repository)
		.where(and(eq(repository.id, scopedRepositoryId), eq(repository.workspaceId, workspaceId)))
		.limit(1);

	const repo = rows[0];
	if (repo === undefined) error(400, "this issue's repository is no longer linked");
	return { repo, number: bare };
}
