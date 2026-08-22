import { callerOf, requireWorkspace } from "@/lib/server/access.server";
import { subscribe } from "@/lib/server/events.server";
import type { RealtimeEvent } from "@/lib/types";
import type { RequestEvent } from "./$types";

/** Proxies and browsers both give up on a quiet connection; this stays under that. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events for one workspace. Every issue and comment change made by
 * anyone in the workspace arrives here, and the client patches its local state
 * rather than refetching the list.
 */
export async function GET({ locals, params, request }: RequestEvent): Promise<Response> {
	const { workspace } = await requireWorkspace(callerOf(locals), params.workspace);

	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// The client is gone and the stream is already closing.
					stop();
				}
			};

			const stop = () => {
				unsubscribe?.();
				unsubscribe = null;
				if (heartbeat !== null) clearInterval(heartbeat);
				heartbeat = null;
			};

			// Tells the browser not to reconnect faster than this, and gives the
			// connection something to prove it is open.
			send("retry: 3000\n\n");

			unsubscribe = subscribe(workspace.id, (event: RealtimeEvent) => {
				send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			});

			heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

			request.signal.addEventListener("abort", () => {
				stop();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			unsubscribe?.();
			if (heartbeat !== null) clearInterval(heartbeat);
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			// nginx and friends buffer by default, which defeats the whole thing.
			"x-accel-buffering": "no",
		},
	});
}
