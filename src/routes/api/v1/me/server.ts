import * as v from "valibot";
import { UserSummary } from "@/lib/domain/schemas";
import { workspacesFor } from "@/lib/server/agents.server";
import { requireUser } from "@/lib/server/guards.server";
import { handler } from "./$types";

/**
 * Who the presented credential belongs to — the simplest way to test a key or
 * an agent token.
 *
 * For an agent this reports the *bot*, which is the whole point: it is the
 * identity its writes will carry — along with every workspace it can reach,
 * which is whatever the person named by `installedBy` belongs to.
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
				installedBy: v.string(),
				/** Every workspace this agent can act in. */
				workspaces: v.array(v.object({ slug: v.string(), name: v.string() })),
			}),
		),
	}),
	async handle({ locals }) {
		const user = requireUser(locals);
		const agent = locals.agent;
		return {
			user,
			authVia: locals.authVia ?? "session",
			agent:
				agent === null
					? null
					: {
							clientId: agent.clientId,
							installedBy: agent.installedByUserId,
							workspaces: await workspacesFor(agent.installedByUserId),
						},
		};
	},
});
