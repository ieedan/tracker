import { auth } from "@/lib/server/auth.server";
import { requireInteractiveSession } from "@/lib/server/guards.server";
import { handler } from "./$types";

export const DELETE = handler({
	async handle({ locals, params, request }) {
		requireInteractiveSession(locals);
		await auth.api.deleteApiKey({ body: { keyId: params.id }, headers: request.headers });
	},
});
