/**
 * What a pull request changing means for the issues it names.
 *
 * Two jobs, both of them things somebody would otherwise do by hand every time:
 * keeping the stored pull request snapshot true without waiting for a page view
 * to notice, and moving an issue along when the work on it visibly starts or
 * lands. A delivery is untrusted input that has already been proved to come
 * from the provider — the adapter does the proving, this decides what it means.
 *
 * Everything in here is idempotent. Providers retry deliveries, and the same
 * `pull_request` event arriving twice must not produce two timeline entries or
 * two notifications, so each step compares against what is stored and does
 * nothing when there is nothing to change.
 */
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { IssueStatus } from "@/lib/domain/issues";
import { isClosedStatus, STATUS_LABELS, STATUS_ORDER } from "@/lib/domain/issues";
import type { IssueMention } from "@/lib/domain/mentions";
import { pullRequestMentions } from "@/lib/domain/mentions";
import type { GitProviderId } from "@/lib/domain/providers";
import { recordActivity } from "./activity.server";
import { db } from "./db.server";
import { emitIssueEvent } from "./events.server";
import { announceIssueStatusOnFeedback } from "./feedback.server";
import { getIssueById } from "./issues.server";
import { issueAudience, notify, readNotificationsForClosedIssue } from "./notifications.server";
import type { RemotePullRequestEvent } from "./providers/types.server";
import {
	account,
	issue,
	providerInstallation,
	pullRequest,
	repository,
	team,
	user,
	workspace,
	workspaceMember,
} from "./schema.server";
import { identifierFor } from "./serialize.server";

type RepositoryRow = typeof repository.$inferSelect;
type IssueRow = typeof issue.$inferSelect;
type UserRow = typeof user.$inferSelect;

/** An issue the pull request names, with why we think it names it. */
interface Target {
	row: IssueRow;
	key: string;
	/** Whether landing this pull request should finish the issue. */
	closes: boolean;
}

/**
 * Applies one verified delivery, everywhere the repository is linked.
 *
 * The same repository can be linked by more than one workspace — two teams
 * tracking the same open source project is the obvious case — and a delivery
 * arrives once for all of them, so this fans out rather than picking one.
 */
export async function applyPullRequestEvent(
	provider: GitProviderId,
	event: RemotePullRequestEvent,
): Promise<{ repositories: number; failed: number }> {
	const repositories = await db
		.select()
		.from(repository)
		.where(
			and(
				eq(repository.provider, provider),
				eq(repository.externalId, event.repository.externalId),
			),
		);

	let failed = 0;
	for (const repo of repositories) {
		// One workspace failing must not cost the others their update, so the
		// fan-out finishes and the count of failures is what the caller answers
		// with. Asking the provider to retry is safe precisely because everything
		// that did work is a no-op the second time.
		try {
			await applyToRepository(repo, event);
		} catch {
			failed += 1;
		}
	}

	return { repositories: repositories.length, failed };
}

async function applyToRepository(
	repo: RepositoryRow,
	event: RemotePullRequestEvent,
): Promise<void> {
	const workspaces = await db
		.select()
		.from(workspace)
		.where(eq(workspace.id, repo.workspaceId))
		.limit(1);
	const workspaceRow = workspaces[0];
	if (workspaceRow === undefined) return;

	const actor = await actorFor(repo, event);
	if (actor === null) return;

	const existing = await linkedPullRequest(repo.id, event.pull.number);
	if (existing !== undefined) await refreshSnapshot(existing, event);

	const mentioned = await issuesForMentions(
		repo.workspaceId,
		pullRequestMentions({
			title: event.pull.title,
			body: event.body,
			headRef: event.headRef,
		}),
	);

	// Linking is only for a pull request nobody has claimed yet: the 1:1 in the
	// schema means the first claim wins, and silently re-pointing a link a person
	// made would be worse than leaving it alone.
	const linked = existing ?? (await autoLink(repo, event, mentioned, actor.id));
	if (linked === null || linked === undefined) return;

	// Only the linked issue follows the pull request. Anything else it names is a
	// reference, and moving somebody else's issue because a pull request pointed
	// at it is the kind of automation people turn off.
	const target = await targetFor(linked, mentioned);
	if (target !== null) await moveIssue(workspaceRow, repo, actor, target, event);
}

/**
 * The linked issue, with whether this pull request claims to finish it.
 *
 * A link somebody made by hand counts as a claim on its own: choosing an issue
 * out of a picker and attaching this pull request to it says the same thing
 * "fixes" says, and would be a strange thing to then have to write down.
 */
async function targetFor(
	linked: typeof pullRequest.$inferSelect,
	mentioned: Target[],
): Promise<Target | null> {
	const fromMention = mentioned.find((candidate) => candidate.row.id === linked.issueId);
	if (fromMention !== undefined) return fromMention;

	const rows = await db
		.select({ issue, key: team.key })
		.from(issue)
		.innerJoin(team, eq(team.id, issue.teamId))
		.where(eq(issue.id, linked.issueId))
		.limit(1);

	const row = rows[0];
	return row === undefined ? null : { row: row.issue, key: row.key, closes: true };
}

// --- the pull request row ---------------------------------------------------

async function linkedPullRequest(
	repositoryId: string,
	number: number,
): Promise<typeof pullRequest.$inferSelect | undefined> {
	const rows = await db
		.select()
		.from(pullRequest)
		.where(and(eq(pullRequest.repositoryId, repositoryId), eq(pullRequest.number, number)))
		.limit(1);
	return rows[0];
}

/**
 * Writes the provider's version of the pull request over ours.
 *
 * This is the half of the feature that removes the polling: `refreshPullRequest`
 * still exists as the fallback for deployments with no webhook configured, but
 * where there is one the stored row is already right by the time anybody looks.
 */
async function refreshSnapshot(
	row: typeof pullRequest.$inferSelect,
	event: RemotePullRequestEvent,
): Promise<void> {
	await db
		.update(pullRequest)
		.set({
			title: event.pull.title,
			state: event.pull.state,
			url: event.pull.url,
			authorLogin: event.pull.authorLogin,
			remoteUpdatedAt: new Date(event.pull.updatedAt),
			syncedAt: new Date(),
		})
		.where(eq(pullRequest.id, row.id));
}

/**
 * Attaches the pull request to the first issue it claims that is free to take it.
 *
 * Claims only — a link occupies the one pull request slot an issue has, and
 * "see also ENG-40 for background" is not somebody saying this is the work on
 * ENG-40. The same rule decides both halves of this feature, which is what
 * makes it explainable: a pull request named after an issue, or closing it by
 * keyword, is that issue's pull request, and everything else is a reference.
 *
 * "First" is the order the mentions appear in — title, then body, then branch —
 * which is the order somebody reading the pull request would pick too. Returns
 * null when every claimed issue already has a pull request, which is not a
 * failure: an issue with a pull request is a link somebody already made.
 */
async function autoLink(
	repo: RepositoryRow,
	event: RemotePullRequestEvent,
	targets: Target[],
	actorId: string,
): Promise<typeof pullRequest.$inferSelect | null> {
	for (const target of targets) {
		if (!target.closes) continue;

		const taken = await db
			.select({ id: pullRequest.id })
			.from(pullRequest)
			.where(eq(pullRequest.issueId, target.row.id))
			.limit(1);
		if (taken[0] !== undefined) continue;

		const row = {
			id: nanoid(),
			issueId: target.row.id,
			repositoryId: repo.id,
			externalId: event.pull.externalId,
			number: event.pull.number,
			title: event.pull.title,
			state: event.pull.state,
			url: event.pull.url,
			authorLogin: event.pull.authorLogin,
			remoteUpdatedAt: new Date(event.pull.updatedAt),
			syncedAt: new Date(),
			linkedBy: actorId,
			createdAt: new Date(),
		};

		try {
			await db.insert(pullRequest).values(row);
		} catch {
			// Lost a race with a person clicking "Link", or with a retry of this
			// very delivery. Either way it is linked, which is what we wanted.
			return null;
		}

		await recordActivity(target.row.id, actorId, [
			{ type: "pull_request_linked", to: `${repo.owner}/${repo.name}#${event.pull.number}` },
		]);

		// Linking says which repository the work is in, the same way the manual
		// link does, so an unscoped issue gets scoped by it.
		if (target.row.repositoryId === null) {
			await db.update(issue).set({ repositoryId: repo.id }).where(eq(issue.id, target.row.id));
		}

		return row;
	}

	return null;
}

// --- which issues this is about ---------------------------------------------

/**
 * Mentions turned into issues, in the order they were mentioned.
 *
 * Every mention is a guess — `UTF-8` parses as neatly as `ENG-42` does — so the
 * database is the filter: a mention that names no team key in this workspace,
 * or no issue under it, simply is not one.
 */
async function issuesForMentions(workspaceId: string, mentions: IssueMention[]): Promise<Target[]> {
	if (mentions.length === 0) return [];

	const keys = [...new Set(mentions.map((mention) => mention.key))];
	const teams = await db
		.select({ id: team.id, key: team.key })
		.from(team)
		.where(and(eq(team.workspaceId, workspaceId), inArray(team.key, keys)));
	if (teams.length === 0) return [];

	const byKey = new Map(teams.map((row) => [row.key, row.id]));
	const rows = await db
		.select()
		.from(issue)
		.where(
			and(
				inArray(
					issue.teamId,
					teams.map((row) => row.id),
				),
				inArray(
					issue.number,
					mentions.map((mention) => mention.number),
				),
			),
		);

	const found: Target[] = [];
	for (const mention of mentions) {
		const teamId = byKey.get(mention.key);
		if (teamId === undefined) continue;
		// The query above is a cross product of keys and numbers, so ENG-3 and
		// PRD-9 also fetch ENG-9 and PRD-3; the pairing is re-checked here.
		const row = rows.find(
			(candidate) => candidate.teamId === teamId && candidate.number === mention.number,
		);
		if (row === undefined) continue;
		found.push({ row, key: mention.key, closes: mention.closes });
	}

	return found;
}

// --- moving the issue -------------------------------------------------------

/**
 * Where a pull request changing should leave an issue, or null to leave it be.
 *
 * Only ever forwards, and never out of a terminal state: somebody moving an
 * issue to Canceled has made a decision, and a reopened pull request is not an
 * argument against it. Merging only finishes an issue the pull request claimed —
 * named in its title or branch, closed by keyword, or linked by hand — which is
 * GitHub's own rule that a bare mention references rather than closes.
 *
 * "Forward" is measured against `STATUS_ORDER` rather than a single hardcoded
 * status, because there are now two stops along the way — In Progress and In
 * Review — and an issue already past one must not be dragged back to it by an
 * event that only means "this pull request is still open".
 */
function nextStatus(event: RemotePullRequestEvent, target: Target): IssueStatus | null {
	const current = target.row.status;
	if (isClosedStatus(current)) return null;

	const state = event.pull.state;
	if (state === "merged") return target.closes ? "done" : null;
	// Closed without merging says the attempt was abandoned, not that the issue
	// was — whoever owns it decides that.
	if (state === "closed") return null;

	// Sent back to draft says review is paused, not that the work before it was
	// undone — so only the one step back, and only when review was in fact where
	// it stood.
	if (event.action === "converted_to_draft") {
		return current === "in_review" ? "in_progress" : null;
	}

	// Marked ready for review is the one signal that means "review this", so it
	// is the only thing that ever advances an issue to In Review.
	if (event.action === "ready_for_review") {
		return STATUS_ORDER[current] < STATUS_ORDER.in_review ? "in_review" : null;
	}

	// Anything else on a live pull request (opened, reopened, edited) means work
	// has started, so anything not yet at "in progress" catches up to it — but
	// never backward out of a status like In Review that a person, or the
	// ready-for-review automation above, already moved the issue past.
	return STATUS_ORDER[current] < STATUS_ORDER.in_progress ? "in_progress" : null;
}

async function moveIssue(
	workspaceRow: typeof workspace.$inferSelect,
	repo: RepositoryRow,
	actor: UserRow,
	target: Target,
	event: RemotePullRequestEvent,
): Promise<void> {
	const status = nextStatus(event, target);
	if (status === null) return;

	const identifier = identifierFor(target.key, target.row.number);
	const from = target.row.status;

	await db
		.update(issue)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(issue.id, target.row.id), eq(issue.status, from)));

	const updated = await getIssueById(target.row.id);
	// The guarded update is what makes a retried delivery quiet: if the status
	// already moved, nothing was written and nothing should be announced.
	if (updated === undefined || updated.status !== status) return;

	await recordActivity(target.row.id, actor.id, [{ type: "status_changed", from, to: status }]);

	// A merge that finishes the issue settles what was said on the way here, the
	// same as closing it by hand does — swept before the move is announced, so
	// that notification lands unread on a clean slate.
	if (isClosedStatus(status)) await readNotificationsForClosedIssue(target.row.id);

	const reference = `${repo.owner}/${repo.name}#${event.pull.number}`;
	const message = `${reference} moved ${identifier} to ${STATUS_LABELS[status]}`;
	for (const userId of await issueAudience(target.row.id)) {
		await notify({
			userId,
			actorId: actor.id,
			workspaceId: workspaceRow.id,
			issueId: target.row.id,
			type: "issue_status_changed",
			body: message,
		});
	}

	const changes = { status: { from, to: status } };
	const context = {
		workspace: { id: workspaceRow.id, slug: workspaceRow.slug, name: workspaceRow.name },
		actor: { id: actor.id, name: actor.name, email: actor.email, type: actor.type },
		issue: updated,
		changes,
	};
	await emitIssueEvent("issue.updated", context);
	await emitIssueEvent("issue.status_changed", context);

	// A pull request opening or merging moves the issue, which moves the request
	// it came from — the same announcement as an edit made by hand (ENG-77).
	await announceIssueStatusOnFeedback({
		workspace: context.workspace,
		actor: context.actor,
		feedbackId: target.row.feedbackId,
		from,
		to: status,
	});
}

// --- who did it -------------------------------------------------------------

/**
 * The workspace member behind a delivery.
 *
 * Every write here carries an identity — the timeline joins to it, and a
 * notification names it — so a delivery with nobody to attribute it to is one
 * this app cannot record. GitHub names a sender by their account, which is the
 * same account somebody signs in with, so most deliveries resolve to the person
 * who actually opened the pull request.
 *
 * Where they are not a member of this workspace, it falls back to whoever
 * connected the installation: they are the member who chose to let this
 * repository move these issues, so the change is theirs in the sense that
 * matters. Null only when even that person is gone, and nothing is written.
 */
async function actorFor(
	repo: RepositoryRow,
	event: RemotePullRequestEvent,
): Promise<UserRow | null> {
	if (event.sender.externalId !== "") {
		const rows = await db
			.select({ user })
			.from(account)
			.innerJoin(user, eq(user.id, account.userId))
			.innerJoin(workspaceMember, eq(workspaceMember.userId, user.id))
			.where(
				and(
					eq(account.providerId, repo.provider),
					eq(account.accountId, event.sender.externalId),
					eq(workspaceMember.workspaceId, repo.workspaceId),
				),
			)
			.limit(1);

		const found = rows[0];
		if (found !== undefined) return found.user;
	}

	const rows = await db
		.select({ user })
		.from(providerInstallation)
		.innerJoin(user, eq(user.id, providerInstallation.createdBy))
		.where(eq(providerInstallation.id, repo.installationId))
		.limit(1);

	return rows[0]?.user ?? null;
}
