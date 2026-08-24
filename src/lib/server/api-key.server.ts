import { defaultKeyHasher } from "@better-auth/api-key";
import { eq } from "drizzle-orm";
import { db } from "./db.server";
import { apikey, user } from "./schema.server";

export interface ApiKeyPrincipal {
	user: App.SessionUser;
	keyId: string;
}

/** The key a request is presenting, from either accepted header. */
export function presentedApiKey(headers: Headers): string | null {
	const direct = headers.get("x-api-key");
	if (direct !== null && direct !== "") return direct;

	const authorization = headers.get("authorization");
	if (authorization !== null && authorization.startsWith("Bearer ")) {
		const value = authorization.slice("Bearer ".length).trim();
		if (value !== "") return value;
	}
	return null;
}

/**
 * Resolves an API key to its owner, without going through better-auth's
 * session machinery.
 *
 * The plugin can mock a session for a key (`enableSessionForAPIKeys`), but it
 * ships off by default and warns against it, because a mocked session makes the
 * key valid on *every* session-authenticated endpoint — including better-auth's
 * own `change-password` and `delete-user`. A leaked read-only key would then be
 * able to take over the account.
 *
 * Looking the key up directly keeps it scoped to this app's API: keys never
 * become sessions, so `/api/auth/*` stays cookie-only. The plugin still owns
 * issuing, listing and revoking, and `defaultKeyHasher` is its own hasher, so
 * the stored digests stay in step with it.
 */
export async function resolveApiKey(presented: string): Promise<ApiKeyPrincipal | null> {
	const hashed = await defaultKeyHasher(presented);

	const rows = await db
		.select({ key: apikey, owner: user })
		.from(apikey)
		.innerJoin(user, eq(user.id, apikey.referenceId))
		.where(eq(apikey.key, hashed))
		.limit(1);

	const row = rows[0];
	if (row === undefined) return null;
	if (row.key.enabled === false) return null;
	if (row.key.expiresAt !== null && row.key.expiresAt.getTime() <= Date.now()) return null;

	// Best-effort usage stamp — a failure here must not fail the request.
	void db
		.update(apikey)
		.set({
			lastRequest: new Date(),
			requestCount: (row.key.requestCount ?? 0) + 1,
			updatedAt: new Date(),
		})
		.where(eq(apikey.id, row.key.id))
		.catch(() => undefined);

	return {
		user: {
			id: row.owner.id,
			name: row.owner.name,
			email: row.owner.email,
			image: row.owner.image ?? null,
		},
		keyId: row.key.id,
	};
}
