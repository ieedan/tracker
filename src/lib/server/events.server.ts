import type { RealtimeEvent } from "@/lib/types";

/**
 * The fan-out behind the SSE endpoint. Subscribers are held per workspace in
 * this process — which is all a single-node deployment needs, and the point at
 * which a second node would need Postgres `LISTEN`/`NOTIFY` instead.
 */

type Subscriber = (event: RealtimeEvent) => void;

const KEY = Symbol.for("tracker:events");
const holder = globalThis as { [KEY]?: Map<string, Set<Subscriber>> };
const rooms = (holder[KEY] ??= new Map<string, Set<Subscriber>>());

export function subscribe(workspaceId: string, subscriber: Subscriber): () => void {
	let room = rooms.get(workspaceId);
	if (room === undefined) {
		room = new Set();
		rooms.set(workspaceId, room);
	}
	room.add(subscriber);

	return () => {
		room.delete(subscriber);
		if (room.size === 0) rooms.delete(workspaceId);
	};
}

export function publish(workspaceId: string, event: RealtimeEvent): void {
	const room = rooms.get(workspaceId);
	if (room === undefined) return;
	for (const subscriber of room) {
		// One broken subscriber must not stop the rest from being notified.
		try {
			subscriber(event);
		} catch {
			/* the stream is closing; the unsubscribe is already queued */
		}
	}
}

export function subscriberCount(workspaceId: string): number {
	return rooms.get(workspaceId)?.size ?? 0;
}
