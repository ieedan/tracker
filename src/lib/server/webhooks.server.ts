/**
 * Webhook delivery.
 *
 * The shape here is dictated by where this runs. Kit has no background-work
 * primitive and the Vercel adapter exposes no `waitUntil`, so there is nowhere
 * to hand an unfinished promise once a response goes out. Work started with
 * `void` may simply be abandoned when the invocation ends.
 *
 * So the delivery table *is* the queue:
 *
 *   1. `enqueue` writes one `pending` row per matching webhook, awaited, inside
 *      the request. Once that commits the event cannot be lost.
 *   2. `dispatchPending` then attempts those rows opportunistically. If the
 *      runtime lets it finish, the webhook arrives immediately.
 *   3. Anything still pending — abandoned, timed out, or refused — is retried by
 *      `drainDue`, which a cron hits. That is what makes delivery a guarantee
 *      rather than a hope.
 *
 * Delivery is therefore at-least-once: a receiver must treat the delivery id as
 * an idempotency key.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { matchesFilter, type FilterSubject } from "@/lib/domain/webhook-filters";
import {
	DELIVERY_HEADER,
	DELIVERY_TIMEOUT_MS,
	EVENT_HEADER,
	MAX_DELIVERY_ATTEMPTS,
	MAX_STORED_RESPONSE_BODY,
	RETRY_BACKOFF_MS,
	SIGNATURE_HEADER,
	TIMESTAMP_HEADER,
	validateHeader,
	type WebhookEvent,
} from "@/lib/domain/webhooks";
import { db } from "./db.server";
import { webhook, webhookDelivery } from "./schema.server";

/** Deliveries attempted at once, so one slow endpoint cannot stall the rest. */
const CONCURRENCY = 4;

export const newWebhookSecret = (): string => `whsec_${randomBytes(24).toString("hex")}`;

/** `sha256=<hex>` over the exact bytes sent. */
export function sign(secret: string, body: string): string {
	return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time compare, for receivers written against this codebase. */
export function verify(secret: string, body: string, signature: string): boolean {
	const expected = Buffer.from(sign(secret, body));
	const actual = Buffer.from(signature);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Refuses URLs that point back inside the network this server runs in.
 *
 * A webhook URL is attacker-supplied by definition — anyone who can administer
 * a workspace can aim it anywhere — so without this the endpoint is a
 * server-side request forgery primitive: `http://169.254.169.254/` reads cloud
 * instance credentials, and `http://10.x` reaches internal services.
 *
 * Loopback is allowed outside production, because testing a webhook against a
 * local listener is the normal way to develop against one.
 */
export function assertDeliverableUrl(
	raw: string,
	{ allowLoopback }: { allowLoopback: boolean },
): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("not a valid URL");
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("only http and https URLs can receive webhooks");
	}

	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

	if (host === "localhost" || host.endsWith(".localhost")) {
		if (!allowLoopback) throw new Error("localhost cannot receive webhooks");
		return url;
	}

	const version = isIP(host);
	if (version === 0) {
		// A name, not a literal. It could still resolve into private space; DNS is
		// re-resolved at connect time so checking here would not bind anyway.
		// Documented as a known limitation rather than pretended away.
		return url;
	}

	if (isBlockedAddress(host, version)) {
		if (version === 4 && host.startsWith("127.") && allowLoopback) return url;
		if (version === 6 && host === "::1" && allowLoopback) return url;
		throw new Error("that address is not reachable for webhooks");
	}

	return url;
}

/** Loopback, private, link-local, and the cloud metadata address. */
function isBlockedAddress(host: string, version: number): boolean {
	if (version === 6) {
		const lower = host.toLowerCase();
		if (lower === "::1" || lower === "::") return true;
		// Unique-local (fc00::/7) and link-local (fe80::/10 — fe80 through febf).
		if (/^f[cd]/.test(lower)) return true;
		if (/^fe[89ab]/.test(lower)) return true;
		// IPv4-mapped addresses. `new URL()` canonicalises `::ffff:127.0.0.1` into
		// the hex form `::ffff:7f00:1`, so matching only the dotted-quad spelling
		// leaves a loopback bypass wide open.
		const mapped = mappedIpv4(lower);
		if (mapped !== null) return isBlockedAddress(mapped, 4);
		return false;
	}

	const parts = host.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
	const [a, b] = parts as [number, number, number, number];

	if (a === 0 || a === 127) return true; // this host, loopback
	if (a === 10) return true; // private
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 168) return true; // private
	if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
	if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
	if (a >= 224) return true; // multicast and reserved
	return false;
}

/**
 * The IPv4 inside an IPv4-mapped IPv6 address, in either spelling:
 * `::ffff:127.0.0.1` and its canonical form `::ffff:7f00:1`.
 */
function mappedIpv4(lower: string): string | null {
	const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
	if (dotted !== null) return dotted[1]!;

	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
	if (hex === null) return null;

	const high = Number.parseInt(hex[1]!, 16);
	const low = Number.parseInt(hex[2]!, 16);
	return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export interface EventPayload {
	event: WebhookEvent;
	workspace: { id: string; slug: string; name: string };
	actor: {
		id: string;
		name: string;
		email: string;
		type?: "human" | "agent";
		onBehalfOf?: { id: string; name: string } | null;
	} | null;
	data: Record<string, unknown>;
}

/**
 * Records the event for every webhook subscribed to it.
 *
 * Awaited by callers: this is the durable step. Returns the delivery ids so the
 * caller can kick off `dispatchPending` for exactly those.
 */
export async function enqueue(
	payload: EventPayload,
	options: { webhookId?: string; ignoreFilter?: boolean } = {},
): Promise<string[]> {
	// `webhookId` narrows the fan-out to one endpoint — what a test send needs,
	// so testing one webhook does not fire every other subscriber with it.
	const conditions = [eq(webhook.workspaceId, payload.workspace.id), eq(webhook.enabled, true)];
	if (options.webhookId !== undefined) conditions.push(eq(webhook.id, options.webhookId));

	const hooks = await db
		.select()
		.from(webhook)
		.where(and(...conditions));

	const subject: FilterSubject = {
		event: payload.event,
		actor: payload.actor,
		data: payload.data,
	};

	const subscribed = hooks.filter(
		(hook) =>
			hook.events.includes(payload.event) &&
			(options.ignoreFilter === true || passesFilter(hook, subject)),
	);
	if (subscribed.length === 0) return [];

	const createdAt = new Date();
	const rows = subscribed.map((hook) => {
		const id = nanoid();
		// The delivery id is inside the signed body as well as in a header, so a
		// receiver can deduplicate on it without trusting headers. That holds in
		// both formats: the text wrapper carries the same JSON, id included.
		const event = {
			id,
			event: payload.event,
			createdAt: createdAt.toISOString(),
			workspace: payload.workspace,
			actor: payload.actor,
			data: payload.data,
		};
		const body = JSON.stringify(hook.format === "text" ? { text: renderText(event) } : event);

		return {
			id,
			webhookId: hook.id,
			event: payload.event,
			payload: body,
			status: "pending" as const,
			attempts: 0,
			responseStatus: null,
			error: null,
			nextAttemptAt: createdAt,
			deliveredAt: null,
			createdAt,
		};
	});

	await db.insert(webhookDelivery).values(rows);
	return rows.map((row) => row.id);
}

/**
 * A `text`-format receiver takes freeform text, not a schema — a Claude Code
 * routine's API trigger reads the body's `text` field and hands it to an agent
 * verbatim, and caps it at 65,536 characters. So: a summary line the agent can
 * title its work from, then the canonical JSON it can parse for the rest.
 */
const MAX_TEXT_LENGTH = 60_000;

function renderText(event: {
	id: string;
	event: WebhookEvent;
	createdAt: string;
	workspace: EventPayload["workspace"];
	actor: EventPayload["actor"];
	data: Record<string, unknown>;
}): string {
	const subject = subjectOf(event.data);
	const by = event.actor === null ? "" : ` (by ${event.actor.name})`;
	const headline =
		`tracker ${event.event} in ${event.workspace.name}` +
		(subject === null ? "" : `: ${subject}`) +
		by;

	const text = `${headline}\n\nFull event payload (JSON):\n${JSON.stringify(event, null, 2)}`;
	if (text.length <= MAX_TEXT_LENGTH) return text;

	const compact = `${headline}\n\nFull event payload (JSON):\n${JSON.stringify(event)}`;
	if (compact.length <= MAX_TEXT_LENGTH) return compact;
	return `${compact.slice(0, MAX_TEXT_LENGTH)}\n… (truncated)`;
}

/** `ENG-42 — Fix login redirect`, from whichever entity the event carries. */
function subjectOf(data: Record<string, unknown>): string | null {
	for (const key of ["issue", "feedback"]) {
		const entity = data[key];
		if (entity === null || typeof entity !== "object") continue;
		const { identifier, title } = entity as { identifier?: unknown; title?: unknown };
		if (typeof identifier === "string" && typeof title === "string") {
			return `${identifier} — ${title}`;
		}
	}
	return null;
}

/**
 * Whether a webhook's conditions accept this event.
 *
 * Fails *open*. A tree is validated before it is stored, so a throw here means
 * something unforeseen — and dropping events silently is a far worse failure
 * than sending one the receiver did not want.
 */
function passesFilter(hook: WebhookRow, subject: FilterSubject): boolean {
	try {
		return matchesFilter(hook.filter, subject);
	} catch {
		return true;
	}
}

/**
 * Attempts the given deliveries now. Never throws — a webhook failing must not
 * fail the request that produced the event.
 */
export async function dispatchPending(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	try {
		const rows = await db
			.select({ delivery: webhookDelivery, hook: webhook })
			.from(webhookDelivery)
			.innerJoin(webhook, eq(webhook.id, webhookDelivery.webhookId))
			.where(and(inArray(webhookDelivery.id, ids), eq(webhookDelivery.status, "pending")));

		await inBatches(rows, (row) => attempt(row.delivery, row.hook));
	} catch {
		// Whatever went wrong here, `drainDue` will pick the rows up later.
	}
}

/**
 * Retries every delivery that is pending and due. This is what a cron calls;
 * it is also what makes delivery reliable rather than best-effort.
 */
export async function drainDue(limit = 50): Promise<{ attempted: number }> {
	const now = new Date();
	const rows = await db
		.select({ delivery: webhookDelivery, hook: webhook })
		.from(webhookDelivery)
		.innerJoin(webhook, eq(webhook.id, webhookDelivery.webhookId))
		.where(
			and(
				eq(webhookDelivery.status, "pending"),
				eq(webhook.enabled, true),
				or(
					lte(webhookDelivery.nextAttemptAt, now),
					// A row whose attempt was abandoned mid-flight has no due date.
					sql`${webhookDelivery.nextAttemptAt} is null`,
				),
			),
		)
		.orderBy(webhookDelivery.createdAt)
		.limit(limit);

	await inBatches(rows, (row) => attempt(row.delivery, row.hook));
	return { attempted: rows.length };
}

type DeliveryRow = typeof webhookDelivery.$inferSelect;
type WebhookRow = typeof webhook.$inferSelect;

/**
 * The headers a delivery goes out with. The webhook's own headers go on first,
 * so the pipeline's always win: a workspace can add an `Authorization` its
 * gateway wants; it can never rewrite the signature the receiver verifies
 * against. Also what the delivery detail endpoint hands out, so a copied curl
 * command carries a signature the receiver actually accepts.
 */
export function requestHeadersFor(
	hook: Pick<WebhookRow, "headers" | "secret">,
	delivery: Pick<DeliveryRow, "id" | "event" | "payload">,
	sentAt: Date,
): Record<string, string> {
	return {
		...customHeaders(hook.headers),
		"content-type": "application/json",
		"user-agent": "tracker-webhooks/1",
		[EVENT_HEADER]: delivery.event,
		[DELIVERY_HEADER]: delivery.id,
		[TIMESTAMP_HEADER]: sentAt.toISOString(),
		[SIGNATURE_HEADER]: sign(hook.secret, delivery.payload),
	};
}

/** One HTTP attempt, and the bookkeeping for whatever it returns. */
async function attempt(delivery: DeliveryRow, hook: WebhookRow): Promise<void> {
	const attempts = delivery.attempts + 1;
	const sentAt = new Date();

	let responseStatus: number | null = null;
	let responseBody: string | null = null;
	let durationMs: number | null = null;
	let failure: string | null = null;

	// Started before the URL check so a refused URL reads as 0ms, and a timeout
	// as the full eight seconds — the number says where the time went.
	const started = Date.now();
	try {
		assertDeliverableUrl(hook.url, { allowLoopback: allowLoopbackTargets() });

		// AbortSignal.timeout rather than a race, so the socket is actually torn
		// down instead of left hanging.
		const response = await fetch(hook.url, {
			method: "POST",
			headers: requestHeadersFor(hook, delivery, sentAt),
			body: delivery.payload,
			signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
		});

		responseStatus = response.status;
		// Draining the body is mandatory anyway — the socket leaks otherwise — so
		// keep a slice of it: it is usually the only clue to *why* an endpoint
		// refused a delivery.
		const text = await response.text().catch(() => "");
		durationMs = Date.now() - started;
		responseBody = text === "" ? null : text.slice(0, MAX_STORED_RESPONSE_BODY);

		if (!response.ok) failure = `endpoint responded ${response.status}`;
	} catch (cause) {
		durationMs = Date.now() - started;
		failure = cause instanceof Error ? cause.message : String(cause);
	}

	if (failure === null) {
		await db
			.update(webhookDelivery)
			.set({
				status: "succeeded",
				attempts,
				responseStatus,
				responseBody,
				durationMs,
				error: null,
				nextAttemptAt: null,
				deliveredAt: new Date(),
			})
			.where(eq(webhookDelivery.id, delivery.id));
		return;
	}

	const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
	const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]!;

	await db
		.update(webhookDelivery)
		.set({
			status: exhausted ? "failed" : "pending",
			attempts,
			responseStatus,
			responseBody,
			durationMs,
			error: failure.slice(0, 500),
			nextAttemptAt: exhausted ? null : new Date(Date.now() + backoff),
		})
		.where(eq(webhookDelivery.id, delivery.id));
}

/**
 * The stored headers, re-checked on the way out.
 *
 * They were validated when they were saved, but a row can predate a rule or be
 * edited straight in the database, and one bad header would make `fetch` throw
 * and fail the whole delivery. A rejected header is dropped; the rest still go.
 */
function customHeaders(stored: Record<string, string> | null): Record<string, string> {
	// JSON out of a column is only as well-typed as whatever wrote it.
	if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return {};

	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(stored)) {
		if (typeof value !== "string") continue;
		if (validateHeader(name, value) !== null) continue;
		headers[name.trim()] = value;
	}
	return headers;
}

/** Loopback targets are for developing against; never in production. */
function allowLoopbackTargets(): boolean {
	return process.env.NODE_ENV !== "production";
}

/** Runs the tasks a few at a time. */
async function inBatches<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
	for (let index = 0; index < items.length; index += CONCURRENCY) {
		const slice = items.slice(index, index + CONCURRENCY);
		await Promise.all(slice.map((item) => run(item).catch(() => undefined)));
	}
}

/** Health summary shown next to each webhook in settings. */
export interface WebhookHealth {
	lastAt: Date | null;
	lastStatus: string | null;
	/** Start of the current unbroken run of failures, or null if not failing. */
	failingSince: Date | null;
}

export async function healthOf(webhookIds: string[]): Promise<Map<string, WebhookHealth>> {
	const health = new Map<string, WebhookHealth>();
	if (webhookIds.length === 0) return health;
	for (const id of webhookIds) {
		health.set(id, { lastAt: null, lastStatus: null, failingSince: null });
	}

	const recent = await db
		.select()
		.from(webhookDelivery)
		.where(inArray(webhookDelivery.webhookId, webhookIds))
		.orderBy(desc(webhookDelivery.createdAt))
		.limit(200);

	// Newest first. The first row per webhook is its latest state; the failing
	// run is the streak of failures before the first non-failure, so a single
	// success in between correctly ends it.
	const streakOpen = new Set(webhookIds);

	for (const row of recent) {
		const entry = health.get(row.webhookId);
		if (entry === undefined) continue;

		if (entry.lastAt === null) {
			entry.lastAt = row.createdAt;
			entry.lastStatus = row.status;
			if (row.status !== "failed") streakOpen.delete(row.webhookId);
		}

		if (!streakOpen.has(row.webhookId)) continue;
		if (row.status === "failed") entry.failingSince = row.createdAt;
		else streakOpen.delete(row.webhookId);
	}

	return health;
}
