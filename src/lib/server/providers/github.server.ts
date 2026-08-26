/**
 * The GitHub adapter.
 *
 * Access comes from a **GitHub App installation**, not from the token of
 * whoever signed in. That distinction is the point: an App is installed onto an
 * organization by somebody with authority over it, grants only the repositories
 * they picked, and keeps working when that person leaves. Reusing a user's
 * OAuth token would mean this app's access to a company's code silently
 * depended on one employee's account.
 *
 * Installation tokens last an hour, so they are minted on demand and cached
 * until shortly before they expire.
 */
import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import type { PullRequestState } from "@/lib/domain/providers";
import { env } from "@/lib/env.server";
import type {
	GitProvider,
	InstallationContext,
	RemotePullRequest,
	RemoteRepository,
	WebhookDelivery,
} from "./types.server";

/** github.com by default; an Enterprise Server install sets its own root. */
const api = (): string => env.GITHUB_API_URL.replace(/\/+$/, "");
const ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";

/** GitHub rejects tokens older than 10 minutes; 9 leaves room for clock skew. */
const JWT_LIFETIME_SECONDS = 9 * 60;
/** Installation tokens last an hour. Re-mint a minute early. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

const appConfigured = (): boolean => env.GITHUB_APP_ID !== "" && env.GITHUB_APP_PRIVATE_KEY !== "";
const devTokenConfigured = (): boolean => env.GITHUB_DEV_TOKEN !== "";

/**
 * The PEM, with `\n` escapes turned back into newlines.
 *
 * A private key does not survive a `.env` line intact, so escaping it is the
 * normal way to carry one — and a key that is *almost* right fails deep inside
 * the signing call with an unhelpful error, so it is normalised in one place.
 */
function privateKey(): string {
	return env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n").trim();
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** RS256, signed by hand — one dependency's worth of code for one algorithm. */
function appJwt(): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		// Backdated by a minute: GitHub rejects a token whose `iat` is in the
		// future, and a server clock a few seconds fast is common.
		iat: now - 60,
		exp: now + JWT_LIFETIME_SECONDS,
		iss: env.GITHUB_APP_ID,
	};

	const body = `${base64url(header)}.${base64url(payload)}`;

	const signer = createSign("RSA-SHA256");
	signer.update(body);
	return `${body}.${signer.sign(privateKey(), "base64url")}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** An installation token, minted on demand and reused until it nearly expires. */
async function installationToken(installationId: string): Promise<string> {
	// The development escape hatch: a PAT stands in for an installation so the
	// feature can be exercised without creating and installing a real App.
	if (!appConfigured() && devTokenConfigured()) return env.GITHUB_DEV_TOKEN;

	const cached = tokenCache.get(installationId);
	if (cached !== undefined && cached.expiresAt - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
		return cached.token;
	}

	const response = await fetch(`${api()}/app/installations/${installationId}/access_tokens`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${appJwt()}`,
			accept: ACCEPT,
			"x-github-api-version": API_VERSION,
		},
	});

	if (!response.ok) {
		throw new Error(`GitHub refused an installation token (${response.status})`);
	}

	const body = (await response.json()) as { token: string; expires_at: string };
	tokenCache.set(installationId, {
		token: body.token,
		expiresAt: new Date(body.expires_at).getTime(),
	});
	return body.token;
}

async function call<T>(
	context: InstallationContext,
	path: string,
	init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
	const token = await installationToken(context.externalId);
	const response = await fetch(`${api()}${path}`, {
		...init,
		headers: {
			...init.headers,
			authorization: `Bearer ${token}`,
			accept: ACCEPT,
			"x-github-api-version": API_VERSION,
		},
	});

	if (!response.ok) return { ok: false, status: response.status };
	return { ok: true, data: (await response.json()) as T };
}

// --- shapes, narrowed to what is actually read ------------------------------

interface GhRepository {
	id: number;
	name: string;
	full_name: string;
	private: boolean;
	html_url: string;
	description: string | null;
	default_branch: string;
	owner: { login: string };
}

interface GhPullRequest {
	id: number;
	number: number;
	title: string;
	state: "open" | "closed";
	draft: boolean;
	merged_at: string | null;
	html_url: string;
	updated_at: string;
	user: { login: string } | null;
}

function toRepository(row: GhRepository): RemoteRepository {
	return {
		externalId: `${row.id}`,
		owner: row.owner.login,
		name: row.name,
		defaultBranch: row.default_branch,
		private: row.private,
		url: row.html_url,
		description: row.description ?? "",
	};
}

/**
 * GitHub's two booleans and one enum, flattened to one state.
 *
 * Order matters: a merged pull request is also `closed`, and a draft is also
 * `open`, so the more specific answer has to be checked first.
 */
function toState(row: GhPullRequest): PullRequestState {
	if (row.merged_at !== null) return "merged";
	if (row.state === "closed") return "closed";
	return row.draft ? "draft" : "open";
}

function toPullRequest(row: GhPullRequest): RemotePullRequest {
	return {
		externalId: `${row.id}`,
		number: row.number,
		title: row.title,
		state: toState(row),
		url: row.html_url,
		authorLogin: row.user?.login ?? "",
		updatedAt: row.updated_at,
	};
}

// --- inbound deliveries -----------------------------------------------------

/** The `pull_request` payload, narrowed to the parts that are read. */
interface GhPullRequestEvent {
	action: string;
	pull_request: GhPullRequest & { body: string | null; head: { ref: string } };
	repository: GhRepository;
	sender: { id: number; login: string } | null;
}

/**
 * The delivery's signature, checked against the shared secret.
 *
 * `sha256=` prefixed hex, compared in constant time — a signature check that
 * returns early on the first wrong character tells an attacker how much of a
 * guess was right, which is enough to find the rest one byte at a time.
 */
function signatureMatches(raw: string, presented: string): boolean {
	const expected = `sha256=${createHmac("sha256", env.GITHUB_APP_WEBHOOK_SECRET)
		.update(raw)
		.digest("hex")}`;

	const left = Buffer.from(presented);
	const right = Buffer.from(expected);
	if (left.length !== right.length) {
		timingSafeEqual(right, right);
		return false;
	}
	return timingSafeEqual(left, right);
}

function readDelivery(raw: string, headers: Headers): WebhookDelivery {
	// No secret means no delivery can be told apart from a forgery, and a
	// forged pull request event moves somebody's issues. Closed is the only
	// safe default.
	if (env.GITHUB_APP_WEBHOOK_SECRET === "") return { kind: "unconfigured" };

	const presented = headers.get("x-hub-signature-256") ?? "";
	if (presented === "" || !signatureMatches(raw, presented)) return { kind: "unsigned" };

	// Only pull requests, and only the actions that change what an issue should
	// say. `synchronize` fires on every push to the branch and carries nothing
	// new; answering it would multiply this endpoint's work by the size of the
	// day's commits.
	if (headers.get("x-github-event") !== "pull_request") return { kind: "ignored" };

	let payload: GhPullRequestEvent;
	try {
		payload = JSON.parse(raw) as GhPullRequestEvent;
	} catch {
		return { kind: "ignored" };
	}

	const acted = new Set([
		"opened",
		"reopened",
		"closed",
		"edited",
		"ready_for_review",
		"converted_to_draft",
	]);
	if (!acted.has(payload.action)) return { kind: "ignored" };

	const pull = payload.pull_request;
	if (pull === undefined || payload.repository === undefined) return { kind: "ignored" };

	return {
		kind: "pull_request",
		event: {
			deliveryId: headers.get("x-github-delivery") ?? "",
			action: payload.action,
			repository: {
				externalId: `${payload.repository.id}`,
				owner: payload.repository.owner.login,
				name: payload.repository.name,
			},
			pull: toPullRequest(pull),
			body: pull.body ?? "",
			headRef: pull.head?.ref ?? "",
			sender: {
				externalId: payload.sender === null ? "" : `${payload.sender.id}`,
				login: payload.sender?.login ?? "",
			},
		},
	};
}

export const github: GitProvider = {
	id: "github",

	configured: () => appConfigured() || devTokenConfigured(),

	installUrl(state) {
		if (env.GITHUB_APP_SLUG === "") return null;
		const url = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
		url.searchParams.set("state", state);
		return url.toString();
	},

	async listRepositories(context) {
		const found: RemoteRepository[] = [];

		// An installation can cover hundreds of repositories, and the picker is
		// unusable without all of them, so this pages to the end rather than
		// showing a truncated list that looks like the whole thing.
		for (let page = 1; page <= 10; page++) {
			const path = appConfigured()
				? `/installation/repositories?per_page=100&page=${page}`
				: `/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page=${page}`;

			const result = await call<GhRepository[] | { repositories: GhRepository[] }>(context, path);
			if (!result.ok) break;

			const batch = Array.isArray(result.data) ? result.data : result.data.repositories;
			found.push(...batch.map(toRepository));
			if (batch.length < 100) break;
		}

		return found.toSorted((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
	},

	async getRepository(context, owner, name) {
		const result = await call<GhRepository>(context, `/repos/${owner}/${name}`);
		return result.ok ? toRepository(result.data) : null;
	},

	async listFiles(context, repository, ref) {
		const result = await call<{
			tree: Array<{ path: string; type: string }>;
			truncated: boolean;
		}>(context, `/repos/${repository.owner}/${repository.name}/git/trees/${ref}?recursive=1`);

		if (!result.ok) return { paths: [], truncated: false };

		return {
			// `blob` only — a directory is not something you reference with `@`.
			paths: result.data.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path),
			// GitHub caps a recursive tree at 100k entries and says so; the caller
			// surfaces it rather than pretending the index is complete.
			truncated: result.data.truncated,
		};
	},

	async getPullRequest(context, repository, number) {
		const result = await call<GhPullRequest>(
			context,
			`/repos/${repository.owner}/${repository.name}/pulls/${number}`,
		);
		return result.ok ? toPullRequest(result.data) : null;
	},

	fileUrl(repository, ref, path) {
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		return `https://github.com/${repository.owner}/${repository.name}/blob/${ref}/${encoded}`;
	},

	readWebhook: readDelivery,
};
