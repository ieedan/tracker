import { eq } from "drizzle-orm";
import * as v from "valibot";
import { UpdateMeBody, UserSummary } from "@/lib/domain/schemas";
import { workspacesFor } from "@/lib/server/agents.server";
import { db } from "@/lib/server/db.server";
import { requireInteractiveSession, requireUser } from "@/lib/server/guards.server";
import { claimImageKey, discardImage } from "@/lib/server/images.server";
import { user } from "@/lib/server/schema.server";
import { toUser, userImageUrl } from "@/lib/server/serialize.server";
import { ownsImageKey } from "@/lib/server/storage.server";
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
		const caller = requireUser(locals);
		const agent = locals.agent;
		return {
			// `locals.user` carries the raw column, which may be an object key.
			user: { ...caller, image: userImageUrl(caller.id, caller.image) },
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

/**
 * Your own profile picture.
 *
 * Session-only, like the other things that change who you are rather than what
 * a workspace contains: a key or an agent token was handed to a tool to do
 * work, not to repaint the person who issued it. That also settles "may only
 * change your own" without a check — there is no other user to name here, and
 * `claimImageKey` refuses a key that was presigned for somebody else.
 */
export const PATCH = handler({
	body: UpdateMeBody,
	response: UserSummary,
	async handle({ locals, body }) {
		const caller = requireInteractiveSession(locals);

		const image = body.imageKey === null ? null : await claimImageKey(caller.id, body.imageKey);

		await db.update(user).set({ image, updatedAt: new Date() }).where(eq(user.id, caller.id));

		// The object the profile used to point at is now unreachable; drop it
		// after the row is safely updated, never before. A picture that came from
		// an identity provider is a URL on their servers rather than an object of
		// ours, so only a key this app issued is worth deleting.
		if (caller.image !== null && caller.image !== image && ownsImageKey(caller.id, caller.image)) {
			await discardImage(caller.image);
		}

		return toUser({ ...caller, image });
	},
});
