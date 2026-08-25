import { Fragment } from "@implementjs/core";
import { PageMeta, pageTitle } from "@/lib/head";
import { NewWorkspacePage } from "@/lib/features/workspaces/new-workspace-page";

export default function Page() {
	return Fragment(
		PageMeta({
			title: pageTitle("New workspace"),
			description: "Create a workspace to organise your teams, issues, and feedback.",
		}),
		NewWorkspacePage(),
	);
}
