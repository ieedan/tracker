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
}
