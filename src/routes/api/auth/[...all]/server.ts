import { auth } from "@/lib/server/auth.server";
import type { RequestEvent } from "./$types";

/**
 * better-auth owns everything under `/api/auth` — the GitHub redirect, the
 * callback, sign-out, and the API key endpoints the plugin adds.
 */

export function GET({ request }: RequestEvent): Promise<Response> {
	return auth.handler(request);
}

export function POST({ request }: RequestEvent): Promise<Response> {
	return auth.handler(request);
}
