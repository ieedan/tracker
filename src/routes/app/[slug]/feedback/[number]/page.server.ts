import { error } from "@implementjs/kit/server";
import { getFeedbackByNumber, listFeedbackComments } from "@/lib/server/feedback.server";
import { requireMembership } from "@/lib/server/guards.server";
import type { LoadEvent } from "./$types";

export default async function load({ locals, params }: LoadEvent) {
	const { workspace } = await requireMembership(locals, params.slug);

	const number = Number(params.number);
	if (!Number.isSafeInteger(number) || number < 1) error(404, `no feedback FB-${params.number}`);

	const found = await getFeedbackByNumber(workspace.id, number, "member");
	if (found === undefined) error(404, `no feedback FB-${number}`);

	return { feedback: found, comments: await listFeedbackComments(found.id, "member") };
}
