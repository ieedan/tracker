import * as v from "valibot";
import { ApiKeySchema, CreateApiKeyBody } from "@/lib/domain/schemas";
import { auth } from "@/lib/server/auth.server";
import { requireInteractiveSession } from "@/lib/server/guards.server";
import { handler, json } from "./$types";

export const GET = handler({
	response: v.array(ApiKeySchema),
	async handle({ locals, request }) {
		requireInteractiveSession(locals);
		// `listApiKeys` answers with a paginated envelope, not a bare array.
		const { apiKeys } = await auth.api.listApiKeys({ headers: request.headers });
		return apiKeys.map(toApiKey);
	},
});

/**
 * Mints a key. The plaintext is returned **once** — it is stored hashed, so
 * there is no way to show it again afterwards.
 */
export const POST = handler({
	body: CreateApiKeyBody,
	response: v.object({ key: ApiKeySchema, plaintext: v.string() }),
	async handle({ locals, request, body }) {
		requireInteractiveSession(locals);
		const created = await auth.api.createApiKey({
			body: { name: body.name },
			headers: request.headers,
		});
		return json({ key: toApiKey(created), plaintext: created.key }, { status: 201 });
	},
});

interface KeyRow {
	id: string;
	name?: string | null;
	start?: string | null;
	prefix?: string | null;
	enabled?: boolean | null;
	createdAt: Date | string;
	lastRequest?: Date | string | null;
}

const asIso = (value: Date | string | null | undefined): string | null => {
	if (value === null || value === undefined) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

function toApiKey(row: KeyRow): v.InferOutput<typeof ApiKeySchema> {
	return {
		id: row.id,
		name: row.name ?? null,
		start: row.start ?? null,
		prefix: row.prefix ?? null,
		enabled: row.enabled ?? true,
		createdAt: asIso(row.createdAt) ?? new Date(0).toISOString(),
		lastRequest: asIso(row.lastRequest),
	};
}
