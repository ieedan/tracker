import { redirect } from "@implementjs/kit/server";
import type { LoadEvent } from "./$types";

export default function load({ locals }: LoadEvent) {
	// The marketing page is not the point of this app; go where the user can work.
	if (locals.user !== null) redirect(303, "/app");
	redirect(303, "/login");
}
