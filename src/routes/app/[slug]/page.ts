import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { IssueListPage } from "@/lib/features/issues/issue-list-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) => pageTitle("All issues", data.workspace.name)),
			description: props.data.bind(
				(data) => `Every open and closed issue across the ${data.workspace.name} workspace.`,
			),
		}),
		IssueListPage(props),
	);
}
