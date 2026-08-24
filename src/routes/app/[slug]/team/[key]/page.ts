import { IssueListPage } from "@/lib/features/issues/issue-list-page";
import type { PageProps } from "./$types";

export default function Page(props: PageProps) {
	return IssueListPage(props);
}
