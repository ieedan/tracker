import { router } from "$implement/router";
import { Aside, Div, H2, Implement, Main, Nav, Span } from "@implementjs/core";
import { ArrowLeftIcon } from "@implementjs/lucide";
import { env } from "@/lib/env.public";
import { WorkspaceContext, WorkspaceStore } from "@/lib/workspace-context";
import type { LayoutProps } from "./$types";

/**
 * Settings is a full-page takeover with its own navigation, the way Linear
 * does it — which is why this layout resets rather than nesting inside the
 * issue shell. The escape hatch is the back link at the top, not a sidebar
 * that is still sitting there.
 */
export default function Layout({ children, data }: LayoutProps) {
	const store = new WorkspaceStore(data.get());

	return WorkspaceContext.Provide(store).To(
		Implement.Head(Implement.Head.Title(`Settings · ${env.PUBLIC_APP_NAME}`)),
		Implement.Watch([data], (next) => store.reseed(next)),

		Div(
			{ class: "flex h-dvh overflow-hidden" },

			Aside(
				{ class: "hidden w-56 shrink-0 flex-col border-r bg-muted/30 md:flex" },

				Div(
					{ class: "px-2 py-2" },
					router.Link(
						{
							to: "/:workspace",
							params: { workspace: store.workspace.get().slug },
							class:
								"flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
						},
						ArrowLeftIcon({ class: "size-4" }),
						store.workspace.bind((workspace) => `Back to ${workspace.name}`),
					),
				),

				Nav(
					{ class: "flex flex-1 flex-col gap-4 px-2 py-2" },

					Section(
						"Workspace",
						SettingsLink(store.workspace.get().slug, "/:workspace/settings", "General"),
						SettingsLink(store.workspace.get().slug, "/:workspace/settings/labels", "Labels"),
						SettingsLink(store.workspace.get().slug, "/:workspace/settings/statuses", "Workflow"),
						SettingsLink(store.workspace.get().slug, "/:workspace/settings/webhooks", "Webhooks"),
					),

					Section(
						"Account",
						SettingsLink(
							store.workspace.get().slug,
							"/:workspace/settings/preferences",
							"Preferences",
						),
						SettingsLink(store.workspace.get().slug, "/:workspace/settings/api-keys", "API keys"),
					),
				),
			),

			Main({ class: "flex min-h-0 min-w-0 flex-1 flex-col" }, children),
		),
	);
}

function Section(heading: string, ...links: ReturnType<typeof SettingsLink>[]) {
	return Div(
		{ class: "flex flex-col gap-0.5" },
		H2({ class: "px-2 py-1 text-xs font-medium text-muted-foreground" }, heading),
		...links,
	);
}

type SettingsPath =
	| "/:workspace/settings"
	| "/:workspace/settings/labels"
	| "/:workspace/settings/statuses"
	| "/:workspace/settings/webhooks"
	| "/:workspace/settings/preferences"
	| "/:workspace/settings/api-keys";

function SettingsLink(workspace: string, to: SettingsPath, label: string) {
	return router.Link(
		{
			to,
			params: { workspace },
			// `end` is not a thing here, so /settings would light up for every child
			// route. Matching is exact by way of aria-current, which the router sets
			// only on the current path.
			class:
				"rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
		},
		Span(label),
	);
}
