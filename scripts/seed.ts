/**
 * Seeding runs inside the app rather than out here: the demo user is created
 * through better-auth, which needs the app's configuration, its database
 * handle, and its password hasher. This just calls the endpoint that does it.
 */

const base = process.env.PUBLIC_APP_URL ?? "http://localhost:5173";

let response: Response;
try {
	response = await fetch(`${base}/api/dev/seed`, { method: "POST" });
} catch {
	console.error(`Could not reach ${base} — start the dev server first (\`bizi run dev\`).`);
	process.exit(1);
}

const body = (await response.json()) as Record<string, unknown>;

if (!response.ok) {
	console.error(`Seeding failed (${response.status}): ${body.message ?? JSON.stringify(body)}`);
	process.exit(1);
}

if (body.seeded === false) {
	console.log(body.message);
} else {
	console.log(`Seeded workspace "${body.workspace}" with ${body.issues} issues.`);
}

const login = body.login as { email: string; password: string } | undefined;
if (login !== undefined) {
	console.log(`\nSign in at ${base}/login\n  ${login.email}\n  ${login.password}`);
}
