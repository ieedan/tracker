import { eq } from "drizzle-orm";
import { type Handle, type HandleServerError } from "@implementjs/kit/server";
import type { Caller } from "@/lib/server/access.server";
import { auth } from "@/lib/server/auth.server";
import { db, schema } from "@/lib/server/db/index.server";
import { ensureBucket } from "@/lib/server/storage.server";

/**
 * Runs once before the first request. The bucket is created here rather than
 * assumed, so a fresh volume (or a MinIO that came up after the app) still
 * works without a manual step.
 */
export async function init(): Promise<void> {
	try {
		await ensureBucket();
	} catch (thrown) {
		console.error("[startup] could not reach object storage — uploads will fail:", thrown);
	}
}

/**
 * Works out who is asking, from either a session cookie or an API key.
 *
 * The two are resolved separately on purpose. better-auth's apiKey plugin can
 * mock a session for a valid key, but that would make a key indistinguishable
 * from a real login at every better-auth endpoint — including the ones that
 * mint more keys or change the account. Verifying the key ourselves keeps its
 * authority to exactly the surface this app checks: `/api/v1`.
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.caller = null;

	try {
		const key = apiKeyFrom(event.request);
		event.locals.caller = key === null ? await fromSession(event.request) : await fromApiKey(key);
	} catch (thrown) {
		// A malformed cookie or a revoked key is an anonymous request, not a 500.
		console.warn("[auth] could not resolve a caller:", thrown);
	}

	return await resolve(event);
};

/** `X-API-Key: trk_…`, or `Authorization: Bearer trk_…`. */
function apiKeyFrom(request: Request): string | null {
	const direct = request.headers.get("x-api-key");
	if (direct !== null && direct.startsWith("trk_")) return direct;

	const authorization = request.headers.get("authorization");
	if (authorization === null) return null;

	const [scheme, value] = authorization.split(" ");
	if (scheme?.toLowerCase() !== "bearer" || value === undefined) return null;
	return value.startsWith("trk_") ? value : null;
}

async function fromSession(request: Request): Promise<Caller | null> {
	const session = await auth.api.getSession({ headers: request.headers });
	if (session === null) return null;

	return {
		id: session.user.id,
		name: session.user.name,
		image: session.user.image ?? null,
		githubLogin: (session.user as { githubLogin?: string | null }).githubLogin ?? null,
		viaApiKey: false,
	};
}

async function fromApiKey(key: string): Promise<Caller | null> {
	// `verifyApiKey` also enforces the key's enabled flag, expiry, remaining
	// count, and rate limit — a rejected key is simply an anonymous request.
	const result = await auth.api.verifyApiKey({ body: { key } });
	if (!result.valid || result.key === null) return null;

	const [user] = await db
		.select()
		.from(schema.user)
		.where(eq(schema.user.id, result.key.referenceId))
		.limit(1);

	if (user === undefined) return null;

	return {
		id: user.id,
		name: user.name,
		image: user.image,
		githubLogin: user.githubLogin,
		viaApiKey: true,
	};
}

export const handleError: HandleServerError = ({ error, event }) => {
	console.error(`[error] ${event.request.method} ${event.url.pathname}`, error);
	return { message: "Something went wrong" };
};
