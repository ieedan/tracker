import * as v from "valibot";
import { UserSummary } from "@/lib/domain/schemas";
import { requireUser } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * Who the presented credential belongs to — the simplest way to test a key or
 * an agent token.
 *
 * For an agent this reports the *bot*, which is the whole point: it is the
 * identity its writes will carry. `agent.installedBy` names the human whose
 * access it borrows.
 */
export const GET = handler({
	response: v.object({
		user: v.object({
			...UserSummary.entries,
			/** For a bot, the human whose delegation it is acting on. */
			onBehalfOf: v.optional(v.nullable(v.object({ id: v.string(), name: v.string() }))),
		}),
		authVia: v.picklist(["session", "api-key", "oauth"]),
		agent: v.nullable(
			v.object({
				clientId: v.string(),
				workspaceId: v.string(),
				installedBy: v.string(),
			}),
		),
	}),
	handle({ locals }) {
		const user = requireUser(locals);
		return {
			user,
			authVia: locals.authVia ?? "session",
			agent:
				locals.agent === null
					? null
					: {
							clientId: locals.agent.clientId,
							workspaceId: locals.agent.workspaceId,
							installedBy: locals.agent.installedByUserId,
						},
		};
	},
});
