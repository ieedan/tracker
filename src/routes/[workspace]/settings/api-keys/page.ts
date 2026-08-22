import { Div, ForEach, If, Implement, P, Pre, Span, signal } from "@implementjs/core";
import { TrashIcon } from "@implementjs/lucide";
import { authApi } from "@/lib/api";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { toast } from "@/lib/toast";
import { SettingsPage } from "@/lib/components/settings-page";
import type { ApiKeyDto } from "@/lib/types";
import { WorkspaceContext } from "@/lib/workspace-context";
import { env } from "@/lib/env.public";

/**
 * API keys for the public API. A key carries its owner's access, which means
 * the same workspaces GitHub says they belong to.
 */
export default function Page() {
	return WorkspaceContext.Use((store) => {
		const keys = signal<ApiKeyDto[]>([]);
		const name = signal("");
		const busy = signal(false);
		/** Shown once, immediately after minting. */
		const freshKey = signal<string | null>(null);

		const refresh = async () => {
			try {
				keys.set(await authApi.apiKeys.list());
			} catch {
				keys.set([]);
			}
		};

		const create = async () => {
			if (name.get().trim() === "") return;
			busy.set(true);
			try {
				const created = await authApi.apiKeys.create(name.get().trim());
				freshKey.set(created.key ?? null);
				name.set("");
				await refresh();
			} catch (thrown) {
				toast.add({
					title: "Could not create the key",
					description: thrown instanceof Error ? thrown.message : "Something went wrong",
					type: "error",
				});
			} finally {
				busy.set(false);
			}
		};

		return SettingsPage(
			"API keys",
			"Keys authenticate the public API. A key carries your access — the same workspaces GitHub says you belong to.",

			Implement.Lifecycle({ onMount: () => void refresh() }),

			P(
				{ class: "text-sm text-muted-foreground" },
				"The full API is described at ",
				Span({ class: "font-mono text-xs" }, "/api/v1/openapi.json"),
				".",
			),

				Div(
					{ class: "flex items-center gap-2" },
					Input({ value: name, placeholder: "What is this key for?", class: "h-9" }),
					Button({ size: "sm", disabled: busy, onClick: () => void create() }, "Create key"),
				),

				If(freshKey.bind((value) => value !== null)).Then(
					Div(
						{ class: "space-y-2 rounded-md bg-muted p-3" },
						Span({ class: "text-xs font-medium" }, "Copy this now — it is not shown again"),
						Div({ class: "font-mono text-xs break-all" }, freshKey.bind((value) => value ?? "")),
						Pre(
							{ class: "overflow-x-auto rounded border bg-background p-2 text-xs" },
							freshKey.bind(
								(value) =>
									`curl -H "Authorization: Bearer ${value ?? ""}" \\\n  ${env.PUBLIC_APP_URL}/api/v1/workspaces/${store.workspace.get().slug}/issues`,
							),
						),
					),
				),

				Div(
					{ class: "divide-y rounded-md border" },
					If(keys.bind((list) => list.length === 0)).Then(
						Div({ class: "px-3 py-6 text-center text-sm text-muted-foreground" }, "No keys yet."),
					),
					ForEach(
						keys,
						(key) => key.id,
						(key) =>
							Div(
								{ class: "group flex items-center gap-3 px-3 py-2" },
								Span({ class: "text-sm" }, key.bind((value) => value.name ?? "Unnamed key")),
								Span(
									{ class: "font-mono text-xs text-muted-foreground" },
									key.bind((value) => `${value.start ?? "trk_"}…`),
								),
								Span(
									{ class: "ml-auto text-xs text-muted-foreground" },
									key.bind((value) =>
										value.lastRequest === null
											? "Never used"
											: `Last used ${new Date(value.lastRequest).toLocaleDateString()}`,
									),
								),
								Button(
									{
										variant: "ghost",
										size: "icon-xs",
										class: "opacity-0 group-hover:opacity-100",
										"aria-label": "Revoke key",
										onClick: () =>
											void authApi.apiKeys
												.remove(key.get().id)
												.then(refresh)
												.catch(() => toast.add({ title: "Could not revoke", type: "error" })),
									},
									TrashIcon({ class: "size-3" }),
								),
							),
					),
			),
		);
	});
}
