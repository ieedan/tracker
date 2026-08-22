import type { Caller } from "@/lib/server/access.server";

declare global {
	namespace App {
		// what src/hooks.server.ts puts on event.locals, and routes read
		interface Locals {
			/**
			 * Whoever is making this request, or null when nobody is signed in.
			 * Optional because kit seeds `event.locals` as `{}` before `handle`
			 * runs — read it through `callerOf(locals)` rather than directly.
			 */
			caller?: Caller | null;
		}
	}
}

export {};
