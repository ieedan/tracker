import * as v from "valibot";
import { UserSummary } from "@/lib/domain/schemas";
import { requireUser } from "@/lib/server/guards.server";
import { handler } from "./$types";

/** Who the presented credential belongs to — the simplest way to test a key. */
export const GET = handler({
	response: v.object({
		user: UserSummary,
		authVia: v.picklist(["session", "api-key"]),
	}),
	handle({ locals }) {
		const user = requireUser(locals);
		return { user, authVia: locals.authVia ?? "session" };
	},
});
