import { Fragment } from "@implementjs/core";
import { FeedbackDetailPage } from "@/lib/features/feedback/feedback-detail-page";
import { metaDescription, PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) =>
				pageTitle(`${data.feedback.identifier} ${data.feedback.title}`),
			),
			description: props.data.bind((data) =>
				metaDescription(
					data.feedback.description,
					`${data.feedback.identifier} — feedback in ${data.workspace.name}.`,
				),
			),
		}),
		FeedbackDetailPage(props),
	);
}
