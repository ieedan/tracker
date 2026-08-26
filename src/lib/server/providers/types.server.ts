/**
 * The seam every git host is reached through.
 *
 * One adapter is implemented (GitHub). The interface exists so the rest of the
 * app never learns which host it is talking to: the routes take a repository
 * row, ask the registry for its adapter, and call these. Adding GitLab means
 * writing one file, not auditing every call site for a hardcoded hostname.
 *
 * Everything here is shaped the way *this* app needs it rather than the way any
 * provider returns it — that translation is the adapter's whole job.
 */
import type { GitProviderId, PullRequestState } from "@/lib/domain/providers";

/** A repository as the provider describes it, before we store our own row. */
export interface RemoteRepository {
	/** The provider's own id, stable across renames. */
	externalId: string;
	owner: string;
	name: string;
	defaultBranch: string;
	private: boolean;
	/** Where a person would go to look at it. */
	url: string;
	description: string;
}

export interface RemotePullRequest {
	externalId: string;
	number: number;
	title: string;
	state: PullRequestState;
	url: string;
	authorLogin: string;
	/** ISO 8601. */
	updatedAt: string;
}

/** What an adapter needs to act on behalf of a workspace. */
export interface InstallationContext {
	/** The provider's id for the grant — a GitHub App installation id. */
	externalId: string;
}

/**
 * A pull request changing, as the provider pushed it to us.
 *
 * Everything needed to act on the change is in here, so the delivery never has
 * to be turned back into an API call: a webhook that answered by fetching what
 * it was just told would be slower *and* rate limited.
 */
export interface RemotePullRequestEvent {
	/** The provider's id for this delivery, for logs. */
	deliveryId: string;
	/** `opened`, `closed`, `reopened`, `edited`, `ready_for_review`, … */
	action: string;
	/** Identified the way a stored repository is — by external id, not by name. */
	repository: { externalId: string; owner: string; name: string };
	pull: RemotePullRequest;
	/** The description, for scanning mentions. */
	body: string;
	/** The source branch, for scanning mentions. */
	headRef: string;
	/** Who on the provider caused it, so the change can be attributed. */
	sender: { externalId: string; login: string };
}

/** What reading a delivery produced. */
export type WebhookDelivery =
	/** Signed correctly and about a pull request. */
	| { kind: "pull_request"; event: RemotePullRequestEvent }
	/** Signed correctly, but nothing here acts on it. */
	| { kind: "ignored" }
	/** Missing or wrong signature — the delivery is not from the provider. */
	| { kind: "unsigned" }
	/** No webhook secret configured, so no delivery can be trusted. */
	| { kind: "unconfigured" };

export interface GitProvider {
	id: GitProviderId;

	/** Everything this installation can see. */
	listRepositories(context: InstallationContext): Promise<RemoteRepository[]>;

	/** One repository, or null when the installation cannot see it any more. */
	getRepository(
		context: InstallationContext,
		owner: string,
		name: string,
	): Promise<RemoteRepository | null>;

	/**
	 * Every file path at a ref.
	 *
	 * Paths only — this is what `@` autocompletes against, and pulling contents
	 * would turn a cheap index into a clone.
	 */
	listFiles(
		context: InstallationContext,
		repository: { owner: string; name: string },
		ref: string,
	): Promise<{ paths: string[]; truncated: boolean }>;

	getPullRequest(
		context: InstallationContext,
		repository: { owner: string; name: string },
		number: number,
	): Promise<RemotePullRequest | null>;

	/** A link a person can click, for a file at a ref. */
	fileUrl(repository: { owner: string; name: string }, ref: string, path: string): string;

	/** Where to send someone to grant access, or null when unconfigured. */
	installUrl(state: string): string | null;

	/** Whether this adapter has the credentials it needs. */
	configured(): boolean;

	/**
	 * Verifies one inbound delivery and narrows it to what this app acts on.
	 *
	 * Takes the raw body rather than parsed JSON because the signature covers
	 * the bytes: re-serialising the object first would change them, and the
	 * comparison would fail for reasons nobody could see.
	 */
	readWebhook(raw: string, headers: Headers): WebhookDelivery;
}
