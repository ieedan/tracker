import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { listFeedback } from "@/lib/server/feedback.server";
import { workspace } from "@/lib/server/schema.server";
import type { LoadEvent } from "./$types";

/**
 * The public board, readable with no account at all.
 *
 * A workspace whose board is closed 404s rather than 403s: whether a slug is a
 * workspace here is not something a stranger is entitled to learn.
 */
export default async function load({ locals, params }: LoadEvent) {
	const rows = await db.select().from(workspace).where(eq(workspace.slug, params.slug)).limit(1);

	const found = rows[0];
	if (found === undefined || found.feedbackBoard !== "public") error(404, "no feedback board here");

	return {
		workspaceName: found.name,
		slug: found.slug,
		feedback: await listFeedback(found.id, { audience: "public" }),
		signedIn: locals.user !== null,
	};
}
