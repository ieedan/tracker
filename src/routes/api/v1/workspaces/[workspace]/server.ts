import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { json } from "@/lib/server/api.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals, params }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);
	return json(workspace);
}
