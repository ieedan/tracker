import { Div, P } from "@implementjs/core";
import { InfoRow, SettingsPage } from "@/lib/components/settings-page";
import { WorkspaceContext } from "@/lib/workspace-context";

/**
 * What this workspace is. Everything here mirrors GitHub, so it reads rather
 * than edits — renaming happens on GitHub and arrives on the next sync.
 */
export default function Page() {
	return WorkspaceContext.Use((store) =>
		SettingsPage(
			"General",
			"This workspace mirrors a GitHub owner. Its name, avatar, and repos come from there.",
			Div(
				{ class: "divide-y rounded-md border" },
				InfoRow("Name", store.workspace.bind("name")),
				InfoRow("GitHub owner", store.workspace.bind("slug")),
				InfoRow(
					"Type",
					store.workspace.bind((workspace) =>
						workspace.type === "Organization" ? "Organization" : "Personal account",
					),
				),
				InfoRow(
					"Issue prefix",
					store.workspace.bind((workspace) => `${workspace.prefix}-1, ${workspace.prefix}-2, …`),
					"Used by issues that are not scoped to a repo. Repo-scoped issues use the repo's name.",
				),
				InfoRow("Repos", store.repos.bind((repos) => `${repos.length}`)),
			),

			P(
				{ class: "text-sm text-muted-foreground" },
				"Membership is GitHub's: anyone who belongs to this owner on GitHub can see this workspace, and nobody else can. There is no invite list to manage here.",
			),
		),
	);
}
