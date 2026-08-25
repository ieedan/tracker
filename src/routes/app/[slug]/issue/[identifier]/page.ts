import { Fragment } from "@implementjs/core";
import { IssueDetailPage } from "@/lib/features/issues/issue-detail-page";
import { metaDescription, PageMeta, pageTitle } from "@/lib/head";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			// `ENG-31 Add route metadata · tracker` — the identifier first, so the
			// browser tab is readable at its narrowest.
			title: props.data.bind((data) => pageTitle(`${data.issue.identifier} ${data.issue.title}`)),
			description: props.data.bind((data) =>
				metaDescription(
					data.issue.description,
					`${data.issue.identifier} in ${data.workspace.name} — ${data.issue.status}, ${data.issue.priority} priority.`,
				),
			),
		}),
		IssueDetailPage(props),
	);
}
