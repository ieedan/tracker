import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { IssueListPage } from "@/lib/features/issues/issue-list-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return Fragment(
		PageMeta({
			title: props.data.bind((data) => pageTitle(`${data.team.name} issues`, data.workspace.name)),
			description: props.data.bind(
				(data) =>
					`Issues belonging to the ${data.team.name} team (${data.team.key}) in ${data.workspace.name}.`,
			),
		}),
		IssueListPage(props),
	);
}
