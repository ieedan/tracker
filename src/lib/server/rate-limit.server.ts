/**
 * A fixed-window rate limiter backed by the database.
 *
 * The window is fixed rather than sliding because the whole thing has to be one
 * statement. A serverless deployment runs this in many processes at once, so a
 * read-then-write would let two invocations both see "4 of 5" and both allow the
 * request; the upsert below decides increment-or-reset inside the database,
 * which is the only place with a consistent view.
 *
 * A fixed window lets a caller spend a full allowance at the end of one window
 * and another at the start of the next. That is the accepted cost: this is spam
 * control on an ingest endpoint, not a billing meter.
 */
import { lt, sql } from "drizzle-orm";
import { db } from "./db.server";
import { rateLimit } from "./schema.server";

export interface RateLimitResult {
	allowed: boolean;
	/** How many more requests this window permits. */
	remaining: number;
	/** Seconds until the window rolls over — the `retry-after` value. */
	retryAfter: number;
}

export async function consume(options: {
	/** Namespaced, e.g. `feedback:public:203.0.113.4`. */
	key: string;
	limit: number;
	windowMs: number;
}): Promise<RateLimitResult> {
	const now = Date.now();
	const resetAt = new Date(now + options.windowMs);

	const rows = await db
		.insert(rateLimit)
		.values({ key: options.key, count: 1, resetAt })
		.onConflictDoUpdate({
			target: rateLimit.key,
			set: {
				// Expired window: start over at one. Live window: one more.
				count: sql`case when ${rateLimit.resetAt} <= ${now} then 1 else ${rateLimit.count} + 1 end`,
				resetAt: sql`case when ${rateLimit.resetAt} <= ${now} then ${resetAt.getTime()} else ${rateLimit.resetAt} end`,
			},
		})
		.returning({ count: rateLimit.count, resetAt: rateLimit.resetAt });

	const row = rows[0];
	// No row back means the write did not land; failing open beats failing the
	// request, since the alternative is a limiter outage taking down ingest.
	if (row === undefined) {
		return { allowed: true, remaining: options.limit - 1, retryAfter: 0 };
	}

	const retryAfter = Math.max(1, Math.ceil((row.resetAt.getTime() - now) / 1000));
	return {
		allowed: row.count <= options.limit,
		remaining: Math.max(0, options.limit - row.count),
		retryAfter,
	};
}

/**
 * The client's address, as far as it can be known.
 *
 * `x-forwarded-for` is trivially forged by a client talking to this server
 * directly, so it is only worth anything behind a proxy that overwrites it —
 * which is exactly what Vercel does. The leftmost entry is the original client.
 */
export function clientAddress(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded !== null && forwarded !== "") {
		const first = forwarded.split(",")[0]?.trim();
		if (first !== undefined && first !== "") return first;
	}
	return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Clears windows that have long since rolled over.
 *
 * Called from the webhook drain, which already runs on a schedule — one table
 * of dead counters is not worth a second cron entry.
 */
export async function purgeExpiredLimits(): Promise<number> {
	const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const rows = await db.delete(rateLimit).where(lt(rateLimit.resetAt, cutoff)).returning({
		key: rateLimit.key,
	});
	return rows.length;
}
