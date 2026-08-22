import { Div, ForEach, Span } from "@implementjs/core";
import { SettingsPage } from "@/lib/components/settings-page";
import { StatusIcon } from "@/lib/components/status-icon";
import { STATUS_CATEGORY_LABELS } from "@/lib/types";
import { WorkspaceContext } from "@/lib/workspace-context";

export default function Page() {
	return WorkspaceContext.Use((store) =>
		SettingsPage(
			"Workflow",
			"The states an issue moves through. Every workspace starts with these.",

			Div(
				{ class: "divide-y rounded-md border" },
				ForEach(
					store.statuses,
					(status) => status.id,
					(status) =>
						Div(
							{ class: "flex items-center gap-2.5 px-3 py-2" },
							StatusIcon(status.get()),
							Span({ class: "text-sm" }, status.bind("name")),
							Span(
								{ class: "ml-auto text-xs text-muted-foreground" },
								status.bind((value) => STATUS_CATEGORY_LABELS[value.category]),
							),
						),
				),
			),

			Div(
				{ class: "text-sm text-muted-foreground" },
				"The category on the right — not the name — is what decides board grouping and when an issue counts as done, so renaming a state is safe.",
			),
		),
	);
}
