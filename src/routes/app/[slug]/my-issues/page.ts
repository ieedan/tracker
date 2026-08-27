import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { MyIssuesPage } from "@/lib/features/issues/my-issues-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			// The tab is not in the title: all three are the same screen, and a tab
			// title that changes under a query-string navigation reads as a different
			// page rather than a different view of one.
			title: props.data.bind((data) => pageTitle("My Issues", data.workspace.name)),
			description: props.data.bind(
				(data) =>
					`Issues assigned to you, filed by you, and followed by you in ${data.workspace.name}.`,
			),
		}),
		MyIssuesPage(props),
	);
}
