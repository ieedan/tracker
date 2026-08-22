import { callerOf, requireUser } from "@/lib/server/access.server";
import { json } from "@/lib/server/api.server";
import { listForUser } from "@/lib/server/workspaces.server";
import type { RequestEvent } from "./$types";

/** Who the caller is, and which workspaces they can reach. */
export async function GET({ locals }: RequestEvent): Promise<Response> {
	const caller = requireUser(callerOf(locals));
	return json({
		user: {
			id: caller.id,
			name: caller.name,
			image: caller.image,
			githubLogin: caller.githubLogin,
		},
		workspaces: await listForUser(caller.id),
	});
}
