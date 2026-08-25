import { redirect } from "@implementjs/kit/server";
import type { LoadEvent } from "./$types";

export default function load({ locals }: LoadEvent) {
	// The hook already guards this path; this narrows the type and covers the
	// case where the guard is ever relaxed.
	if (locals.user === null) redirect(303, "/login");
	return {};
}
