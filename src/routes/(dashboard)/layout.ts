import { IssueManager, IssueManagerContext } from "@/lib/features/issues/issue-manager";
import type { LayoutProps } from "./$types";
import { CreateIssueDialog } from "@/lib/features/issues/create-issue-dialog";

export default function Layout({ data, children }: LayoutProps) {
	const issueManager = new IssueManager(data.bind("issues"), data.bind("labels"), data.bind("teams"));
	return IssueManagerContext.Provide(issueManager).To(
		children,
		CreateIssueDialog({ open: issueManager.createIssueDialogOpen }),
	);
}
