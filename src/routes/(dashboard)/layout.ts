import { IssueManagerContext, IssuesManager } from "@/lib/features/issues/issues-manager";
import type { LayoutProps } from "./$types";
import DashboardSidebar from "@/lib/components/dashboard-sidebar";
import { CreateIssueDialog } from "@/lib/features/issues/create-issue-dialog";

export default function Layout({ data, children }: LayoutProps) {
    const issueManager = new IssuesManager(data.bind("issues"))
    return IssueManagerContext.Provide(issueManager).To(DashboardSidebar(
        children,
        CreateIssueDialog({ open: issueManager.createIssueDialogOpen })
    ))
}
