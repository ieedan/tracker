import { Div, ForEach, H1 } from "@implementjs/core";
import type { PageProps } from "./$types";
import { IssueManagerContext } from "@/lib/features/issues/issues-manager";
import { Button } from "@/lib/components/ui/button";

export default function Page({ }: PageProps) {
	return IssueManagerContext.Use((manager) => {
		return Div(
			H1("Issues"),
			Div(
				ForEach(manager.issues, (issue) => issue.id, (issue) => Div(issue.bind('title')))
			),
			Button({ onClick: () => manager.openCreateIssueDialog() }, "Create Issue")
		)
	})
}
