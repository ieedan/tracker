import { auth, demoSignIn, isTrustedOrigin } from "@/lib/server/auth.server";

// Its own route rather than a branch of `/api/auth/[...all]`, which is
// better-auth's surface and should stay exactly that, and outside `/api/v1`,
// which is the documented API — this exists for the login page alone.
export const openapi = false;

/**
 * Signs the browser in as the demo account, in one request.
 *
 * The sign-in runs here rather than in the page because that is what keeps
 * `DEMO_LOGIN_PASSWORD` server-side: better-auth's `asResponse` hands back its
 * own response, `Set-Cookie` and all, and returning it unchanged gives the
 * browser exactly the session a typed-out sign-in would have produced.
 *
 * A deployment with no demo account configured answers 404 — the same thing it
 * would say if this route did not exist. The button that calls it is hidden in
 * that case too, but the check here is the one that matters: hiding a button
 * does not stop anybody from sending the POST.
 */
export const POST = async (event: { request: Request }): Promise<Response> => {
	const account = demoSignIn();
	if (account === null) {
		return Response.json({ message: "Demo sign-in is not enabled here." }, { status: 404 });
	}

	// Going through `auth.api` skips better-auth's handler, and its origin check
	// with it. Without this, a page anywhere could sign a visitor into the demo
	// account by POSTing here.
	if (!isTrustedOrigin(event.request.headers.get("origin"))) {
		return Response.json({ message: "That origin is not allowed to sign in." }, { status: 403 });
	}

	try {
		return await auth.api.signInEmail({ body: account, asResponse: true });
	} catch (cause) {
		// Wrong password, or an account that this database does not have —
		// a preview branched from a template that predates the seed, most likely.
		// better-auth's own message names the address, so it is not repeated back.
		console.error("Demo sign-in failed.", cause);
		return Response.json(
			{ message: "The demo account could not be signed in. Check the seeded data." },
			{ status: 500 },
		);
	}
};
