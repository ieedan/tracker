import { callerOf, requireUser } from "@/lib/server/access.server";
import { json } from "@/lib/server/api.server";
import { listForUser } from "@/lib/server/workspaces.server";
import type { RequestEvent } from "./$types";

export async function GET({ locals }: RequestEvent): Promise<Response> {
	const caller = requireUser(callerOf(locals));
	return json({ items: await listForUser(caller.id) });
}
