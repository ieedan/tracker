import { redirect } from "@implementjs/kit/server";
import { callerOf } from "@/lib/server/access.server";
import { devLoginEnabled, githubConfigured } from "@/lib/server/auth.server";
import type { LoadEvent } from "./$types";

export default function load({ locals }: LoadEvent) {
	if (callerOf(locals) !== null) redirect(303, "/");

	// The page changes shape depending on what is actually configured, so it can
	// say "add a GitHub OAuth App" instead of showing a button that 500s.
	return { githubConfigured, devLoginEnabled };
}
