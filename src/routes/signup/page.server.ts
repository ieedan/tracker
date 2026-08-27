import { demoSignIn, githubSignInConfigured } from "@/lib/server/auth.server";

/**
 * Which sign-in methods this deployment actually has.
 *
 * The credentials are server-only, so the browser cannot work this out for
 * itself — and a "Sign in with GitHub" button that leads to a configuration
 * error is worse than no button.
 *
 * The demo account is offered here too. Somebody who landed on sign-up in a
 * preview wants to look at the seeded workspace as much as anyone, and a new
 * empty account is not what they came for.
 */
export default function load() {
	return {
		providers: { github: githubSignInConfigured() },
		demo: demoSignIn()?.email ?? null,
	};
}
