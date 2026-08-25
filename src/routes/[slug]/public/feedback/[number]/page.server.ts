import { error } from "@implementjs/kit/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db.server";
import { getFeedbackByNumber, listFeedbackComments } from "@/lib/server/feedback.server";
import { workspace } from "@/lib/server/schema.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const rows = await db.select().from(workspace).where(eq(workspace.slug, params.slug)).limit(1);

	const found = rows[0];
	if (found === undefined || found.feedbackBoard !== "public") error(404, "no feedback board here");

	const number = Number(params.number);
	if (!Number.isSafeInteger(number) || number < 1) error(404, "no such feedback");

	// The public reader, so private feedback is missing rather than forbidden
	// and the submitter's address never leaves the server.
	const entry = await getFeedbackByNumber(found.id, number, "public");
	if (entry === undefined) error(404, "no such feedback");

	return {
		workspaceName: found.name,
		slug: found.slug,
		feedback: entry,
		comments: await listFeedbackComments(entry.id, "public"),
		signedIn: locals.user !== null,
	};
}
