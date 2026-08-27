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
 * own response, `Set-Cookie` and all, and returning a successful one unchanged
 * gives the browser exactly the session a typed-out sign-in would have produced.
 * An unsuccessful one is *not* passed through — see below.
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

	let response: Response;
	try {
		response = await auth.api.signInEmail({ body: account, asResponse: true });
	} catch (cause) {
		console.error("Demo sign-in failed.", cause);
		return misconfigured();
	}

	// `asResponse` is the reason this needs checking rather than only catching:
	// better-call converts an `APIError` into the response instead of throwing
	// it, so wrong credentials arrive here as a 401 the `catch` above never
	// sees. Forwarding it unchanged is what put better-auth's "Invalid email or
	// password" under the button — a message that reads as *the reviewer*
	// mistyping something, when the reviewer typed nothing at all.
	if (!response.ok) {
		console.error(
			`Demo sign-in for ${account.email} was refused (${response.status}): ` +
				`${await response.text()}. DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD have to ` +
				"name an account that is in *this* deployment's database.",
		);
		return misconfigured();
	}

	return response;
};

/**
 * Every failure past the configuration checks is the same failure to whoever
 * pressed the button: the deployment's demo credentials do not open an account
 * in the database behind it. The detail goes to the server log — the browser
 * gets something that points at the deployment rather than at the reviewer.
 */
function misconfigured(): Response {
	return Response.json(
		{ message: "The demo account could not be signed in. Check the seeded data." },
		{ status: 500 },
	);
}
