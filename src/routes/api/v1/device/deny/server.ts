import * as v from "valibot";
import { DenyDeviceBody } from "@/lib/domain/schemas";
import { auth } from "@/lib/server/auth.server";
import { requireInteractiveSession } from "@/lib/server/guards.server";
import { handler } from "./$types";

/** Refuses a device authorization. Nothing is provisioned. */
export const POST = handler({
	body: DenyDeviceBody,
	response: v.object({ ok: v.literal(true) }),
	async handle({ locals, body, request }) {
		requireInteractiveSession(locals);
		await auth.api.deviceDeny({
			body: { userCode: body.userCode },
			headers: request.headers,
		});
		return { ok: true as const };
	},
});
