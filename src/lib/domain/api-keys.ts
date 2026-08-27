// Shared between the API handlers and the browser. No server imports — kit
// forbids a client file from importing an endpoint, and a schema both sides
// need has to live somewhere both can reach.

export const API_KEY_RESOURCES = [
	"issues",
	"workspace",
	"labels",
	"members",
	"webhooks",
	"feedback",
	"notifications",
] as const;
export type ApiKeyResource = (typeof API_KEY_RESOURCES)[number];

export const API_KEY_ACTIONS = ["read", "write"] as const;
export type ApiKeyAction = (typeof API_KEY_ACTIONS)[number];

/** Resource → the actions this key is allowed to perform. */
export type ApiKeyPermissions = Partial<Record<ApiKeyResource, ApiKeyAction[]>>;

export const API_KEY_RESOURCE_LABELS: Record<ApiKeyResource, string> = {
	issues: "Issues",
	workspace: "Workspace",
	labels: "Labels",
	members: "Members",
	webhooks: "Webhooks",
	feedback: "Feedback",
	notifications: "Notifications",
};

export const API_KEY_RESOURCE_HINTS: Record<ApiKeyResource, string> = {
	issues: "Issues, comments, and attachments.",
	workspace: "The workspace itself, plus its teams and templates.",
	labels:
		"The workspace's labels. Writing creates new ones; renaming is not offered, and deleting one is an admin act behind Workspace.",
	members: "People in the workspace, and invite links.",
	webhooks:
		"Outgoing webhooks and their delivery log. Writing means workspace events can be sent to an endpoint this credential picks.",
	feedback: "User feedback, triage, and conversion to issues.",
	notifications: "The signed-in user's inbox.",
};

export const API_KEY_EXPIRATIONS = [
	{ value: "never", label: "Never", seconds: null },
	{ value: "7", label: "7 days", seconds: 7 * 24 * 3600 },
	{ value: "30", label: "30 days", seconds: 30 * 24 * 3600 },
	{ value: "90", label: "90 days", seconds: 90 * 24 * 3600 },
	{ value: "365", label: "1 year", seconds: 365 * 24 * 3600 },
] as const;
export type ApiKeyExpiration = (typeof API_KEY_EXPIRATIONS)[number]["value"];

/**
 * Resources split out of a broader one, and the resource they used to live in.
 *
 * Labels were part of `workspace` until they were given a scope of their own,
 * so a credential holding `workspace` keeps exactly the label access it already
 * had and nothing minted before the split stops working.
 *
 * The implication runs one way only. `labels` never satisfies a `workspace`
 * check, which is the entire point: `labels:write` can be handed out on its own
 * without also handing over repositories, teams, templates and settings.
 */
const RESOURCE_FALLBACKS: Partial<Record<ApiKeyResource, ApiKeyResource>> = {
	labels: "workspace",
};

export function hasPermission(
	granted: ApiKeyPermissions | null,
	resource: ApiKeyResource,
	action: ApiKeyAction,
): boolean {
	// `null` is a key minted before scopes existed — it can do anything the
	// owner can. An empty object is the opposite: explicitly no access.
	if (granted === null) return true;
	if (allows(granted, resource, action)) return true;

	const fallback = RESOURCE_FALLBACKS[resource];
	return fallback !== undefined && allows(granted, fallback, action);
}

/** One resource's actions, with `write` implying `read`. */
function allows(
	granted: ApiKeyPermissions,
	resource: ApiKeyResource,
	action: ApiKeyAction,
): boolean {
	const actions = granted[resource] ?? [];
	if (action === "read") return actions.includes("read") || actions.includes("write");
	return actions.includes("write");
}

/**
 * Turns a stored JSON blob (or the object better-auth already parsed) into
 * the permissions the rest of the app understands.
 *
 * `null` means unrestricted — that is how keys created before scoping look.
 * A parse failure is treated the same way, so a corrupt row does not lock
 * someone out of an otherwise valid key.
 */
export function parsePermissions(raw: unknown): ApiKeyPermissions | null {
	if (raw === null || raw === undefined || raw === "") return null;

	let value: unknown = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

	const granted: ApiKeyPermissions = {};
	for (const resource of API_KEY_RESOURCES) {
		const actions = (value as Record<string, unknown>)[resource];
		if (!Array.isArray(actions)) continue;
		const allowed = actions.filter((action): action is ApiKeyAction =>
			(API_KEY_ACTIONS as readonly string[]).includes(action as string),
		);
		if (allowed.length > 0) granted[resource] = allowed;
	}
	return granted;
}

/** One line for a key row: "Full access", "Read-only", or the resources it can touch. */
export function summarizePermissions(permissions: ApiKeyPermissions | null): string {
	if (permissions === null) return "Full access";

	const granted = API_KEY_RESOURCES.filter((resource) => (permissions[resource]?.length ?? 0) > 0);
	if (granted.length === 0) return "No access";

	const everyResource = granted.length === API_KEY_RESOURCES.length;
	const allWrite =
		everyResource &&
		API_KEY_RESOURCES.every((resource) => permissions[resource]?.includes("write"));
	if (allWrite) return "Full access";

	const allReadOnly =
		everyResource &&
		API_KEY_RESOURCES.every(
			(resource) =>
				permissions[resource]?.includes("read") === true &&
				permissions[resource]?.includes("write") !== true,
		);
	if (allReadOnly) return "Read-only";

	return granted
		.map((resource) => {
			const write = permissions[resource]?.includes("write") === true;
			return write
				? API_KEY_RESOURCE_LABELS[resource]
				: `${API_KEY_RESOURCE_LABELS[resource]} (read)`;
		})
		.join(", ");
}
