// Shared between the API handlers and the browser, like api-keys.ts next door.
//
// Agent scopes deliberately reuse the API-key permission grid rather than
// inventing a second vocabulary: an OAuth scope is just `<resource>:<action>`
// over the same resources, so `hasPermission` and `requirePermission` work on
// an agent token without changes.

import {
	API_KEY_ACTIONS,
	API_KEY_RESOURCES,
	API_KEY_RESOURCE_HINTS,
	API_KEY_RESOURCE_LABELS,
	type ApiKeyAction,
	type ApiKeyPermissions,
	type ApiKeyResource,
} from "./api-keys";

/**
 * Humans sign in; agents never can. An "agent" user row is a bot member of a
 * workspace, created when an OAuth client is authorized into it.
 */
export const USER_TYPES = ["human", "agent"] as const;
export type UserType = (typeof USER_TYPES)[number];

export type AgentScope = `${ApiKeyResource}:${ApiKeyAction}`;

export const AGENT_SCOPES: AgentScope[] = API_KEY_RESOURCES.flatMap((resource) =>
	API_KEY_ACTIONS.map((action): AgentScope => `${resource}:${action}`),
);

/** OIDC scopes the provider understands on top of ours. */
export const OPENID_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/**
 * Resources whose routes are all behind `requireAdmin`, plus the write half of
 * `workspace` (settings, and creating teams).
 *
 * Agents are capped below admin, so these can never be satisfied. Excluding
 * them from what a client may even register for turns a guaranteed 403 into an
 * upfront registration error, which is a much clearer failure.
 */
const ADMIN_ONLY_SCOPES = new Set<AgentScope>([
	"members:write",
	"webhooks:read",
	"webhooks:write",
	"workspace:write",
]);

export function isAgentGrantableScope(scope: AgentScope): boolean {
	return !ADMIN_ONLY_SCOPES.has(scope);
}

/** The scopes a dynamically-registered client is allowed to ask for. */
export const AGENT_GRANTABLE_SCOPES: AgentScope[] = AGENT_SCOPES.filter(isAgentGrantableScope);

function isAgentScope(value: string): value is AgentScope {
	return (AGENT_SCOPES as string[]).includes(value);
}

/**
 * A space-delimited OAuth `scope` string, as the grid the rest of the app reads.
 *
 * Unlike `parsePermissions`, this never returns `null`. `null` means
 * "unrestricted" and exists only for API keys minted before scoping — an agent
 * always has exactly what it was granted, so an empty or unrecognised scope
 * string is `{}`: no access.
 */
export function scopesToPermissions(scope: string | null | undefined): ApiKeyPermissions {
	const granted: ApiKeyPermissions = {};
	if (scope === null || scope === undefined) return granted;

	for (const value of scope.split(/\s+/)) {
		if (!isAgentScope(value)) continue;
		const [resource, action] = value.split(":") as [ApiKeyResource, ApiKeyAction];
		const actions = granted[resource] ?? [];
		if (!actions.includes(action)) actions.push(action);
		granted[resource] = actions;
	}
	return granted;
}

export interface AgentScopeDescription {
	scope: AgentScope;
	label: string;
	hint: string;
}

/** One line per scope for the consent screen. */
export function describeScopes(scopes: readonly string[]): AgentScopeDescription[] {
	return scopes.filter(isAgentScope).map((scope) => {
		const [resource, action] = scope.split(":") as [ApiKeyResource, ApiKeyAction];
		const verb = action === "write" ? "Read and write" : "Read";
		return {
			scope,
			label: `${verb} ${API_KEY_RESOURCE_LABELS[resource].toLowerCase()}`,
			hint: API_KEY_RESOURCE_HINTS[resource],
		};
	});
}
