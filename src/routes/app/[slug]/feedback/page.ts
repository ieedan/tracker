import { Fragment } from "@implementjs/core";
import { FeedbackListPage } from "@/lib/features/feedback/feedback-list-page";
import { PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) => pageTitle("Feedback", data.workspace.name)),
			description: props.data.bind(
				(data) => `Feedback submitted to ${data.workspace.name}, and the issues it became.`,
			),
		}),
		FeedbackListPage(props),
	);
}
