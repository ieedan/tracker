import { applyPullRequestEvent } from "@/lib/server/pull-request-events.server";
import { providerFor } from "@/lib/server/providers/index.server";
import type { RequestEvent } from "./$types";

/**
 * Where GitHub delivers events for the App's installations.
 *
 * There is no session here and there cannot be one: GitHub is the caller. The
 * signature over the raw body is the whole of the authentication, which is why
 * the body is read as text and handed to the adapter unparsed — `JSON.parse`
 * then `JSON.stringify` produces different bytes and the signature would never
 * match.
 *
 * The reply is deliberately uninformative. A delivery that is not signed gets
 * the same shape of answer whether the secret is wrong, missing, or the request
 * was never from GitHub at all; telling an unauthenticated caller which of those
 * it was is telling them how to get closer.
 *
 * Point one App webhook at this URL — `<origin>/api/v1/github/webhook` — with
 * the "Pull requests" event subscribed and `GITHUB_APP_WEBHOOK_SECRET` as the
 * secret. Without the secret set, every delivery is refused.
 */
export async function POST(event: RequestEvent): Promise<Response> {
	const raw = await event.request.text();
	const delivery = providerFor("github").readWebhook(raw, event.request.headers);

	switch (delivery.kind) {
		case "unconfigured":
			// 404 rather than 500: with no secret this endpoint is not open for
			// business, and a deployment that never meant to run it should not look
			// like one that is broken.
			return new Response("not found", { status: 404 });

		case "unsigned":
			return new Response("bad signature", { status: 401 });

		case "ignored":
			// Signed, but nothing here acts on it. 200 so GitHub does not retry an
			// event that will be ignored just as thoroughly the second time.
			return Response.json({ ok: true, applied: 0 });

		case "pull_request": {
			const result = await applyPullRequestEvent("github", delivery.event);
			// A failure asks for the delivery back. GitHub redelivers on a 5xx, and
			// applying the same event twice is a no-op everywhere it already
			// landed — so a retry costs nothing and losing the event costs an issue
			// that never moved.
			if (result.failed > 0) {
				return Response.json(
					{ ok: false, applied: result.repositories - result.failed },
					{ status: 500 },
				);
			}
			return Response.json({ ok: true, applied: result.repositories });
		}
	}
}

/** A provider callback, not part of the documented JSON surface. */
export const openapi = false;
