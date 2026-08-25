import { Fragment } from "@implementjs/core";
import { PublicBoardPage } from "@/lib/features/feedback/public-board";
import { PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		// One of the few routes a crawler can actually reach, so this is the
		// description that ends up in a search result.
		PageMeta({
			title: props.data.bind((data) => pageTitle("Feedback", data.workspaceName)),
			description: props.data.bind(
				(data) =>
					`Read what people are asking for from ${data.workspaceName}, or submit feedback of your own.`,
			),
		}),
		PublicBoardPage(props),
	);
}
