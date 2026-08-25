import { Fragment } from "@implementjs/core";
import { PublicFeedbackPage } from "@/lib/features/feedback/public-board";
import { metaDescription, PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) =>
				pageTitle(`${data.feedback.identifier} ${data.feedback.title}`, data.workspaceName),
			),
			description: props.data.bind((data) =>
				metaDescription(
					data.feedback.description,
					`${data.feedback.title} — feedback on the ${data.workspaceName} board.`,
				),
			),
		}),
		PublicFeedbackPage(props),
	);
}
