import { Fragment } from "@implementjs/core";
import { ConsentPage } from "@/lib/features/agents/consent-page";
import { PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) =>
				pageTitle(data.client === null ? "Authorize agent" : `Authorize ${data.client.name}`),
			),
			description:
				"Review what an agent is asking for before granting it access to your workspaces.",
			// A live authorization request, reachable without a session but never
			// something to index.
			noindex: true,
		}),
		ConsentPage(props),
	);
}
