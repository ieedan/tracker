// The one place a feedback mutation goes through, so every screen updates the
// same way: apply locally, send, roll back on refusal.
import type { Signal } from "@implementjs/core";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import type { Feedback } from "@/lib/domain/schemas";

type Patch = Parameters<
	typeof api.PATCH<"/api/v1/workspaces/[slug]/user-feedback/[id]">
>[1]["body"];

/**
 * Optimistic edit. The list moves the moment you pick, because a status
 * dropdown that waits for a round trip feels broken; a refusal puts the old
 * value back and says why.
 */
export async function patchFeedback(
	list: Signal<Feedback[]>,
	slug: string,
	id: string,
	patch: Patch,
	apply: (value: Feedback) => Feedback,
): Promise<void> {
	const before = list.get();
	list.set(before.map((entry) => (entry.id === id ? apply(entry) : entry)));

	const { data, error } = await api.PATCH("/api/v1/workspaces/[slug]/user-feedback/[id]", {
		params: { slug, id },
		body: patch,
	});

	if (error !== undefined) {
		list.set(before);
		toastError(messageOf(error, "Could not update this feedback"));
		return;
	}

	// The server is authoritative about the rest of the row — a status change
	// can carry an updatedAt the optimistic copy guessed wrong.
	list.set(list.get().map((entry) => (entry.id === id ? data : entry)));
}
