import { and, eq } from "drizzle-orm";
import { Octokit } from "octokit";
import { db, schema } from "./db/index.server";

/**
 * Everything that talks to GitHub. Tracker stores its own issues, so GitHub is
 * only ever asked two things: which owners a user belongs to, and which repos
 * those owners have.
 */

export type GithubOwner = {
	githubId: number;
	login: string;
	name: string;
	avatarUrl: string | null;
	type: "User" | "Organization";
};

export type GithubRepo = {
	githubId: number;
	name: string;
	ownerLogin: string;
	ownerGithubId: number;
	description: string | null;
	isPrivate: boolean;
};

/** The user's GitHub OAuth token, or null if they have no linked GitHub account. */
export async function getAccessToken(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ accessToken: schema.account.accessToken })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
		.limit(1);
	return row?.accessToken ?? null;
}

export function client(token: string): Octokit {
	return new Octokit({ auth: token });
}

/**
 * The owners a token can act for: the user themself, plus every organization
 * they are a member of. This list *is* the permission model — a workspace the
 * caller cannot see is a workspace that isn't in here.
 */
export async function listOwners(token: string): Promise<GithubOwner[]> {
	const gh = client(token);

	const [me, orgs] = await Promise.all([
		gh.rest.users.getAuthenticated(),
		gh.paginate(gh.rest.orgs.listForAuthenticatedUser, { per_page: 100 }),
	]);

	const owners: GithubOwner[] = [
		{
			githubId: me.data.id,
			login: me.data.login,
			name: me.data.name ?? me.data.login,
			avatarUrl: me.data.avatar_url ?? null,
			type: "User",
		},
	];

	for (const org of orgs) {
		owners.push({
			githubId: org.id,
			login: org.login,
			// The list endpoint omits `name`; the login reads fine as a fallback.
			name: (org as { name?: string | null }).name ?? org.login,
			avatarUrl: org.avatar_url ?? null,
			type: "Organization",
		});
	}

	return owners;
}

/** Every repo the token can see, across all of the user's owners. */
export async function listRepos(token: string): Promise<GithubRepo[]> {
	const gh = client(token);
	const repos = await gh.paginate(gh.rest.repos.listForAuthenticatedUser, {
		per_page: 100,
		affiliation: "owner,collaborator,organization_member",
		sort: "pushed",
	});

	return repos.map((repo) => ({
		githubId: repo.id,
		name: repo.name,
		ownerLogin: repo.owner.login,
		ownerGithubId: repo.owner.id,
		description: repo.description ?? null,
		isPrivate: repo.private,
	}));
}
