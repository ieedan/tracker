import { Div, Span } from "@implementjs/core";
import { SettingsPage } from "@/lib/components/settings-page";
import { Button } from "@/lib/components/ui/button";
import { mode } from "@/lib/mode";
import { WorkspaceContext } from "@/lib/workspace-context";

/** Account-level, not workspace-level: these follow you between workspaces. */
export default function Page() {
	return WorkspaceContext.Use((store) =>
		SettingsPage(
			"Preferences",
			"These apply to your account, wherever you are signed in.",

			Div(
				{ class: "flex items-center gap-3 rounded-md border px-3 py-3" },
				Div(
					{ class: "min-w-0 flex-1" },
					Div({ class: "text-sm font-medium" }, "Theme"),
					Div(
						{ class: "text-sm text-muted-foreground" },
						"Follows your system until you pick one.",
					),
				),
				// No mode-dependent label: the server has no OS to ask, so rendering
				// the current theme here would differ on the client and cost a full
				// re-render on hydration.
				Button({ variant: "outline", size: "sm", onClick: () => mode.toggleMode() }, "Toggle"),
				Button(
					{ variant: "ghost", size: "sm", onClick: () => mode.setMode("system") },
					"Use system",
				),
			),

			Div(
				{ class: "flex items-center gap-3 rounded-md border px-3 py-3" },
				Div(
					{ class: "min-w-0 flex-1" },
					Div({ class: "text-sm font-medium" }, "Signed in as"),
					Div(
						{ class: "text-sm text-muted-foreground" },
						store.user.bind((user) => user?.name ?? "—"),
					),
				),
				Span(
					{ class: "text-xs text-muted-foreground" },
					store.user.bind((user) => (user?.githubLogin === null ? "" : `@${user?.githubLogin}`)),
				),
			),
		),
	);
}
