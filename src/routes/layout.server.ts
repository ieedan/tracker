import { callerOf } from "@/lib/server/access.server";
import type { LoadEvent } from "./$types";

/** Every page needs to know whether anyone is signed in. */
export default function load({ locals }: LoadEvent) {
	const caller = callerOf(locals);

	return {
		user:
			caller === null
				? null
				: {
						id: caller.id,
						name: caller.name,
						image: caller.image,
						githubLogin: caller.githubLogin,
					},
	};
}
