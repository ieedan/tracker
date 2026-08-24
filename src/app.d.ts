import type { WorkspaceRole } from "@/lib/domain/issues";

declare global {
	namespace App {
		interface SessionUser {
			id: string;
			name: string;
			email: string;
			image: string | null;
		}

		// what src/hooks.server.ts puts on event.locals, and routes read
		interface Locals {
			user: SessionUser | null;
			/** How the caller authenticated. `null` when they did not. */
			authVia: "session" | "api-key" | null;
		}
	}
}

export type { WorkspaceRole };

export {};
