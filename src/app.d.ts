import type { ApiKeyPermissions } from "@/lib/domain/api-keys";
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
			/**
			 * Scopes on the presented API key. `null` when the caller is a
			 * session, or when the key was minted before scopes existed — both
			 * mean "unrestricted", and membership / admin checks still apply.
			 */
			apiKeyPermissions: ApiKeyPermissions | null;
		}
	}
}

export type { WorkspaceRole };

export {};
