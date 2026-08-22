import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { WebhookEvent } from "@/lib/types";
import { db, schema } from "./db/index.server";

/**
 * Outbound webhooks: tracker POSTs a signed JSON body to URLs a workspace
 * registers. Delivery is fire-and-forget — one attempt, no queue, no retry —
 * and the outcome is recorded on the row so the settings page can show it.
 */

const TIMEOUT_MS = 5_000;

export function generateSecret(): string {
	return `whsec_${randomBytes(24).toString("hex")}`;
}

/**
 * `sha256=<hex>` over `<timestamp>.<body>`, the same shape GitHub and Stripe
 * use. The timestamp is signed too, so a captured delivery cannot be replayed
 * later against a receiver that checks it.
 */
export function sign(secret: string, timestamp: string, body: string): string {
	return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Constant-time comparison, exported so a receiver written against this API can reuse it. */
export function verify(secret: string, timestamp: string, body: string, signature: string): boolean {
	const expected = Buffer.from(sign(secret, timestamp, body));
	const actual = Buffer.from(signature);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function deliver(
	hook: typeof schema.webhook.$inferSelect,
	event: WebhookEvent,
	payload: unknown,
): Promise<void> {
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const body = JSON.stringify({ event, deliveredAt: new Date().toISOString(), data: payload });

	let status: number | null = null;
	let failure: string | null = null;

	try {
		const response = await fetch(hook.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"user-agent": "tracker-webhooks/1",
				"x-tracker-event": event,
				"x-tracker-delivery": crypto.randomUUID(),
				"x-tracker-timestamp": timestamp,
				"x-tracker-signature": sign(hook.secret, timestamp, body),
			},
			body,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		status = response.status;
		if (!response.ok) failure = `responded ${response.status}`;
	} catch (thrown) {
		failure = thrown instanceof Error ? thrown.message : String(thrown);
	}

	await db
		.update(schema.webhook)
		.set({ lastStatus: status, lastError: failure, lastDeliveredAt: new Date() })
		.where(eq(schema.webhook.id, hook.id));
}

/**
 * Sends `event` to every enabled subscriber of `workspaceId`.
 *
 * Deliberately not awaited by callers: a slow subscriber must not slow down the
 * request that triggered it, and a failed delivery is recorded rather than
 * raised. Rejections are swallowed here so this can be called without a
 * `.catch` at every site.
 */
export function dispatch(workspaceId: string, event: WebhookEvent, payload: unknown): void {
	void (async () => {
		try {
			const hooks = await db
				.select()
				.from(schema.webhook)
				.where(and(eq(schema.webhook.workspaceId, workspaceId), eq(schema.webhook.enabled, true)));

			await Promise.all(
				hooks.filter((hook) => hook.events.includes(event)).map((hook) => deliver(hook, event, payload)),
			);
		} catch (thrown) {
			console.error("[webhooks] dispatch failed", thrown);
		}
	})();
}
