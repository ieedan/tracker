import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "@implementjs/kit/server";
import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { db, schema } from "@/lib/server/db/index.server";
import { labelDto, listParticipants } from "@/lib/server/issues.server";
import { listForUser } from "@/lib/server/workspaces.server";

/**
 * The workspace's configuration — statuses, labels, repos, and who is asking.
 *
 * Shared because settings resets the layout chain rather than nesting inside
 * it (Linear's settings is a full-page takeover), so both layouts have to load
 * this for themselves.
 */
export async function loadWorkspaceConfig(locals: App.Locals, slug: string) {
	// A page has somewhere better to send an anonymous visitor than a 401 —
	// `requireWorkspace` answers with a status because the API needs one.
	if (callerOf(locals) === null) redirect(303, "/login");

	const { caller, workspace } = await requireWorkspace(callerOf(locals), slug);

	const [statuses, labels, repos, workspaces, members] = await Promise.all([
		db
			.select()
			.from(schema.status)
			.where(and(eq(schema.status.workspaceId, workspace.id), isNull(schema.status.archivedAt)))
			.orderBy(asc(schema.status.position)),
		db
			.select()
			.from(schema.label)
			.where(eq(schema.label.workspaceId, workspace.id))
			.orderBy(asc(schema.label.name)),
		db
			.select()
			.from(schema.repo)
			.where(eq(schema.repo.workspaceId, workspace.id))
			.orderBy(asc(schema.repo.name)),
		listForUser(caller.id),
		listParticipants(workspace.id),
	]);

	return {
		workspace,
		workspaces,
		user: {
			id: caller.id,
			name: caller.name,
			image: caller.image,
			githubLogin: caller.githubLogin,
		},
		statuses: statuses.map((status) => ({
			id: status.id,
			name: status.name,
			category: status.category,
			color: status.color,
			position: status.position,
		})),
		labels: labels.map(labelDto),
		repos: repos.map((repo) => ({
			id: repo.id,
			name: repo.name,
			description: repo.description,
			isPrivate: repo.isPrivate,
		})),
		members,
	};
}
