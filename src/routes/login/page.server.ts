import { demoSignIn, githubSignInConfigured } from "@/lib/server/auth.server";

/**
 * Which sign-in methods this deployment actually has.
 *
 * The credentials are server-only, so the browser cannot work this out for
 * itself — and a "Sign in with GitHub" button that leads to a configuration
 * error is worse than no button.
 *
 * Only the demo account's *address* crosses over, to label its button. The
 * password never leaves the server; `/api/demo-login` is what uses it.
 */
export default function load() {
	return {
		providers: { github: githubSignInConfigured() },
		demo: demoSignIn()?.email ?? null,
	};
}
