import { error } from "@implementjs/kit/server";
import { timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import { env } from "@/lib/env.server";
import { purgeExpiredLimits } from "@/lib/server/rate-limit.server";
import { drainDue } from "@/lib/server/webhooks.server";
import { handler } from "./$types";

/**
 * Retries every webhook delivery that is pending and due.
 *
 * This is the half that makes delivery reliable: the request that produced an
 * event only *attempts* a send, and on a serverless runtime that attempt can be
 * cut short when the response goes out. Whatever is left over is picked up here.
 *
 * Point a scheduler at it — on Vercel, `vercel.json`:
 *
 *   { "crons": [{ "path": "/api/v1/webhooks/drain", "schedule": "* / 5 * * * *" }] }
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`, which is what this checks.
 * With no `CRON_SECRET` set the route 404s rather than running: an unauthenticated
 * drain is a way to make this server issue outbound requests on demand.
 */
export const POST = handler({
	response: v.object({ attempted: v.number(), purged: v.number() }),
	async handle({ request }) {
		const expected = env.CRON_SECRET;
		if (expected === "") error(404, "not found");

		const presented = request.headers.get("authorization") ?? "";
		if (!matches(presented, `Bearer ${expected}`)) error(401, "bad cron credentials");

		// Rate-limit windows expire on their own; the rows do not. This cron is
		// already running, so it sweeps them rather than earning a second entry.
		const purged = await purgeExpiredLimits();
		const drained = await drainDue();
		return { ...drained, purged };
	},
});

/** Length-independent constant-time compare. */
function matches(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) {
		// Still burn a comparison so the failure path is not obviously shorter.
		timingSafeEqual(right, right);
		return false;
	}
	return timingSafeEqual(left, right);
}

// The drain is operational plumbing, not part of the documented product API.
export const openapi = false;
