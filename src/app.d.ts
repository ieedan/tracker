import type { HarnessKind, UserType } from "@/lib/domain/agents";
import type { ApiKeyPermissions } from "@/lib/domain/api-keys";
import type { WorkspaceRole } from "@/lib/domain/issues";

declare global {
	namespace App {
		interface SessionUser {
			id: string;
			name: string;
			email: string;
			image: string | null;
			/**
			 * Whether this is a person or a bot. Carried here so the webhook
			 * `actor` reports it wherever a route already passes `locals.user`
			 * through, without every call site having to know about agents.
			 */
			type: UserType;
			/** For a bot, which coding agent it is. `null` for a person. */
			harness: HarnessKind | null;
			/** For a bot, the human whose delegation it is acting on. */
			onBehalfOf?: { id: string; name: string } | null;
		}

		/**
		 * Set when the caller is an agent. `user` is then the *bot*, and this is
		 * everything about the grant behind it that the guards need.
		 */
		interface AgentContext {
			grantId: string;
			/**
			 * The person who authorized it. Their memberships are the agent's
			 * reach, and their role in each is its ceiling.
			 */
			installedByUserId: string;
			clientId: string;
		}

		// what src/hooks.server.ts puts on event.locals, and routes read
		interface Locals {
			user: SessionUser | null;
			/** How the caller authenticated. `null` when they did not. */
			authVia: "session" | "api-key" | "oauth" | null;
			/**
			 * What the presented credential is scoped to — an API key's permissions
			 * or an agent token's scopes, which share one vocabulary. `null` when
			 * the caller is a session, or when a key was minted before scopes
			 * existed — both mean "unrestricted", and membership / admin checks
			 * still apply. An agent is never `null`.
			 */
			permissions: ApiKeyPermissions | null;
			/** Non-null only when `authVia` is `"oauth"`. */
			agent: AgentContext | null;
		}
	}
}

export type { WorkspaceRole };

export {};
