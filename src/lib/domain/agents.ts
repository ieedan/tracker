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
 * Scopes whose every route is behind `requireAdmin`.
 *
 * Agents are capped below admin, so these can never be satisfied. Excluding
 * them from what a client may even register for turns a guaranteed 403 into an
 * upfront registration error, which is a much clearer failure.
 *
 * `workspace:write` is deliberately *not* here even though it covers admin
 * routes: it also covers uploading an image and writing a template, which any
 * member can do. `requireAdmin` is what closes the admin half, so excluding the
 * whole scope would only break the parts that were always allowed.
 *
 * `labels:write` is likewise grantable. It was carved out of `workspace:write`
 * precisely so an agent can work with labels without being given the rest of
 * that scope. Creating one is member-level; deleting one moved to
 * `requireAdminAccess` alongside the webhook routes, so it too is satisfiable —
 * by an agent whose approver is an admin, and only there.
 *
 * `webhooks:*` left this set in ENG-65. The webhook routes moved to
 * `requireAdminAccess`, which admits an agent whose approver is an admin — so
 * the scope is now satisfiable, and an agent can subscribe itself to the events
 * it cares about instead of asking a person to click through the settings page.
 */
const ADMIN_ONLY_SCOPES = new Set<AgentScope>(["members:write"]);

export function isAgentGrantableScope(scope: AgentScope): boolean {
	return !ADMIN_ONLY_SCOPES.has(scope);
}

/** The scopes a dynamically-registered client is allowed to ask for. */
export const AGENT_GRANTABLE_SCOPES: AgentScope[] = AGENT_SCOPES.filter(isAgentGrantableScope);

/**
 * Grantable, but never handed out for saying nothing.
 *
 * Registration is open and a client that names no scopes is given the default
 * set, on the reasoning that the tools are not independently useful — creating
 * an issue needs a team key, and finding one needs `workspace:read`. Webhooks
 * are not like that. A webhook posts workspace events to a URL the agent picks,
 * so it is the one scope where "the client did not say" should mean no rather
 * than yes: a client that wants it has to name it, and the person approving it
 * then sees it spelled out on the consent screen.
 */
const OPT_IN_SCOPES = new Set<AgentScope>(["webhooks:read", "webhooks:write"]);

/** What a client registering without a `scope` of its own is given. */
export const AGENT_DEFAULT_SCOPES: AgentScope[] = AGENT_GRANTABLE_SCOPES.filter(
	(scope) => !OPT_IN_SCOPES.has(scope),
);

/**
 * What an agent client may register for, including `offline_access`.
 *
 * Without `offline_access` a grant dies with the browser session that approved
 * it and the agent has to run the device flow again every time it starts. With
 * it, the agent holds a refresh token that outlives the session — which is the
 * whole difference between authorizing once and authorizing every morning.
 */
export const AGENT_REGISTRABLE_SCOPES: string[] = ["offline_access", ...AGENT_GRANTABLE_SCOPES];

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

/**
 * One line per *resource*, not per scope.
 *
 * `write` implies `read` in `hasPermission`, so a grant of both is one
 * capability, not two — listing them separately reads as "Read issues, Read and
 * write issues", which says nothing and looks like a bug.
 */
export function describeScopes(scopes: readonly string[]): AgentScopeDescription[] {
	const granted = scopesToPermissions(scopes.filter(isAgentScope).join(" "));

	return API_KEY_RESOURCES.filter((resource) => (granted[resource]?.length ?? 0) > 0).map(
		(resource) => {
			const write = granted[resource]?.includes("write") === true;
			const action: ApiKeyAction = write ? "write" : "read";
			return {
				scope: `${resource}:${action}` as AgentScope,
				label: `${write ? "Read and write" : "Read"} ${API_KEY_RESOURCE_LABELS[resource].toLowerCase()}`,
				hint: API_KEY_RESOURCE_HINTS[resource],
			};
		},
	);
}

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/**
 * The coding agent behind a client, as asserted by the person authorizing it.
 *
 * Registration is open, so a client's own `client_name` is a claim, not a fact
 * — this is the human's answer to "what actually is this?", which is why it is
 * chosen on the consent screen rather than read off the registration. The
 * catalog exists so a bot shows a real name and mark instead of whatever
 * generic string the harness happened to register with.
 */
export const AGENT_HARNESSES = [
	"claude-code",
	"cursor",
	"codex",
	"opencode",
	"copilot",
	"other",
] as const;
export type HarnessKind = (typeof AGENT_HARNESSES)[number];

const HARNESS_LABELS: Record<HarnessKind, string> = {
	"claude-code": "Claude Code",
	cursor: "Cursor",
	codex: "Codex",
	opencode: "OpenCode",
	copilot: "GitHub Copilot",
	other: "Coding agent",
};

/** The catalog name for a harness. Always the same string for a given kind. */
export function harnessLabel(harness: HarnessKind): string {
	return HARNESS_LABELS[harness];
}

/**
 * What a bot is actually called.
 *
 * A name the person typed always wins — "Claude on CI" is a reasonable thing to
 * call a Claude Code agent, and two agents of the same kind in one workspace
 * need telling apart. The catalog label is only the default for a blank name.
 */
export function agentDisplayName(harness: HarnessKind, name?: string): string {
	const chosen = name?.trim() ?? "";
	return chosen === "" ? harnessLabel(harness) : chosen;
}

export function isHarnessKind(value: string): value is HarnessKind {
	return (AGENT_HARNESSES as readonly string[]).includes(value);
}

/**
 * A first guess at the harness from what the client registered as.
 *
 * Only ever a default for the consent screen's picker — the person confirms or
 * corrects it, and nothing downstream trusts the client's own string.
 */
export function guessHarness(clientName: string): HarnessKind {
	const name = clientName.toLowerCase();
	if (name.includes("claude")) return "claude-code";
	if (name.includes("cursor")) return "cursor";
	if (name.includes("codex")) return "codex";
	if (name.includes("opencode")) return "opencode";
	if (name.includes("copilot")) return "copilot";
	return "other";
}
