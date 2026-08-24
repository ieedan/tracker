import { Div, ForEach, H1, Span, type Signal } from "@implementjs/core";
import { IssueManagerContext } from "@/lib/features/issues/issue-manager";
import type { PageProps } from "./$types";
import type { Issue } from "@/lib/db/types";
import { Button } from "@/lib/components/ui/button";
import { PlusIcon } from "@implementjs/lucide";

export default function Page({}: PageProps) {
	return Div(H1("Issues"), IssueList());
}

function IssueList() {
	return IssueManagerContext.Use((manager) => {
		return Div(
			{ class: "flex flex-col" },
			Button({ onClick: () => manager.openCreateIssueDialog() }, PlusIcon({})),
			ForEach(
				manager.issues,
				(item) => item.id,
				(item) => Issue(item),
			),
		);
	});
}

function Issue(issue: Signal<Issue>) {
	return Div({}, Span(issue.bind("title")));
}
