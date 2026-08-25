import { redirect } from "@implementjs/kit/server";
import { getAgentClient } from "@/lib/server/agents.server";
import type { LoadEvent } from "./$types";

/**
 * Consent for the authorization-code flow.
 *
 * `oauthProvider` requires a consent page, and it must exist even though agents
 * take the device flow: without one, an authorization-code request would
 * redirect to a page that is not there.
 *
 * Consenting here does not create a bot — that happens only on the device
 * flow's own approval, which is where a workspace is chosen. This screen is for
 * a plain "sign in with tracker" client.
 *
 * The provider redirects here with the original authorize query, and expects it
 * handed straight back as `oauth_query`. It is opaque to us; we only read
 * `client_id` and `scope` to say what is being asked for.
 */
export default async function load({ locals, url }: LoadEvent) {
	if (locals.user === null) {
		const next = encodeURIComponent(url.pathname + url.search);
		redirect(303, `/login?next=${next}`);
	}

	const clientId = url.searchParams.get("client_id");
	const client = clientId === null ? null : await getAgentClient(clientId);

	return {
		oauthQuery: url.search.replace(/^\?/, ""),
		client,
		scopes: (url.searchParams.get("scope") ?? "").split(/\s+/).filter((scope) => scope !== ""),
	};
}
