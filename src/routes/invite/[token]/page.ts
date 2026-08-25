import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { InvitePage } from "@/lib/features/workspaces/invite-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) =>
				pageTitle(data.invite === null ? "Invitation" : `Join ${data.invite.workspaceName}`),
			),
			description: props.data.bind((data) =>
				data.invite === null
					? "This invitation is no longer valid."
					: `You have been invited to join the ${data.invite.workspaceName} workspace on tracker.`,
			),
			// The token is in the URL — nothing here belongs in a search index.
			noindex: true,
		}),
		InvitePage(props),
	);
}
