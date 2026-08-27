/**
 * The inbox's reading pane, when the notification is about an issue.
 *
 * It shows the issue itself — the same view as /issue/:identifier, pickers,
 * timeline, comment box and all — rather than a summary of it. A notification
 * is a reason to look at an issue, and everything you want to do on arriving
 * (reply, reassign, close it) was one navigation away from a card that only
 * restated what the row already said.
 *
 * The page loader cannot help here: the issue changes with the selection, not
 * with the URL. So the same five reads it does are made from the browser and
 * assembled into the shape `IssueDetailPage` expects.
 */
import { Div, Dynamic, ImplementEffect, signal, type Readable } from "@implementjs/core";
import { api } from "@/lib/client/api";
import { Spinner } from "@/lib/components/ui/spinner";
import type {
	Activity,
	Attachment,
	Comment,
	Issue,
	Label,
	Member,
	Repository,
	Team,
	Workspace,
} from "@/lib/domain/schemas";
import { IssueDetailPage } from "@/lib/features/issues/issue-detail-page";

/** What the workspace layout already knows, handed down rather than refetched. */
export interface IssuePaneContext {
	workspace: Readable<Workspace>;
	teams: Readable<Team[]>;
	members: Readable<Member[]>;
	labels: Readable<Label[]>;
	viewer: Readable<{ id: string }>;
}

interface DetailData {
	issue: Issue;
	repositories: Repository[];
	attachments: Attachment[];
	comments: Comment[];
	activity: Activity[];
	workspace: Workspace;
	teams: Team[];
	members: Member[];
	labels: Label[];
	subscribed: boolean;
	user: { id: string };
}

export function InboxIssuePane({
	slug,
	identifier,
	context,
}: {
	slug: Readable<string>;
	/** The selected notification's issue. Empty while nothing names one. */
	identifier: Readable<string>;
	context: IssuePaneContext;
}) {
	const detail = signal<DetailData | null>(null);
	/** Arrowing down the list fires a read per row; only the last one may land. */
	let ticket = 0;

	const load = async (issueIdentifier: string) => {
		if (issueIdentifier === "") return;
		const current = ++ticket;
		const workspaceSlug = slug.get();
		const [issueResult, commentResult, activityResult, repoResult, subscribeResult] =
			await Promise.all([
				api.GET("/api/v1/workspaces/[slug]/issues/[identifier]", {
					params: { slug: workspaceSlug, identifier: issueIdentifier },
				}),
				api.GET("/api/v1/workspaces/[slug]/issues/[identifier]/comments", {
					params: { slug: workspaceSlug, identifier: issueIdentifier },
				}),
				api.GET("/api/v1/workspaces/[slug]/issues/[identifier]/activity", {
					params: { slug: workspaceSlug, identifier: issueIdentifier },
				}),
				api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/issues/[identifier]/subscribe", {
					params: { slug: workspaceSlug, identifier: issueIdentifier },
				}),
			]);

		if (current !== ticket) return;
		// The issue is the one read there is no pane without; the rest degrade to
		// empty rather than blanking the whole thing.
		if (issueResult.error !== undefined) return;

		detail.set({
			issue: issueResult.data,
			repositories: repoResult.error === undefined ? repoResult.data : [],
			attachments: issueResult.data.attachments,
			comments: commentResult.error === undefined ? commentResult.data : [],
			activity: activityResult.error === undefined ? activityResult.data : [],
			workspace: context.workspace.get(),
			teams: context.teams.get(),
			members: context.members.get(),
			labels: context.labels.get(),
			subscribed: subscribeResult.error === undefined && subscribeResult.data.subscribed,
			user: context.viewer.get(),
		});
	};

	// Which issue is on screen, not which one was asked for: the detail view is
	// rebuilt when this changes, and rebuilding it on the *request* would throw
	// away the issue still being read while the next one is in flight.
	const shown = detail.bind((value) => value?.issue.identifier ?? "");

	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },
		ImplementEffect([identifier], (next) => void load(next)),

		Dynamic([shown], (value) =>
			value === ""
				? Div(
						{ class: "flex flex-1 items-center justify-center p-8" },
						Spinner({ class: "size-4 text-muted-foreground" }),
					)
				: // A fresh view per issue, the way navigating gives you one: an
					// in-place swap would carry a half-typed comment or an open title
					// editor from the last issue onto this one.
					IssueDetailPage({
						data: detail.bind((current) => current!),
						params: { slug, identifier: shown },
						embedded: true,
					}),
		),
	);
}
