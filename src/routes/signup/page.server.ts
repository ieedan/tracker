import { githubSignInConfigured } from "@/lib/server/auth.server";

/**
 * Which sign-in methods this deployment actually has.
 *
 * The credentials are server-only, so the browser cannot work this out for
 * itself — and a "Sign in with GitHub" button that leads to a configuration
 * error is worse than no button.
 */
export default function load() {
	return { providers: { github: githubSignInConfigured() } };
}
