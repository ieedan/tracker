import { Div, ForEach, If, Implement, P, Span, derived, signal } from "@implementjs/core";
import { TrashIcon } from "@implementjs/lucide";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/lib/components/ui/badge";
import { Button } from "@/lib/components/ui/button";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { Input } from "@/lib/components/ui/input";
import { Label } from "@/lib/components/ui/label";
import { toast } from "@/lib/toast";
import { SettingsPage } from "@/lib/components/settings-page";
import { WEBHOOK_EVENTS, type WebhookDto } from "@/lib/types";
import { WorkspaceContext } from "@/lib/workspace-context";

/**
 * Outbound webhooks. Delivery is a single attempt with no retry, so the last
 * outcome is the whole audit trail and it is shown on every row.
 */
export default function Page() {
	return WorkspaceContext.Use((store) => {
		const hooks = signal<WebhookDto[]>([]);
		const url = signal("");
		// One signal per event, because Checkbox binds a boolean two ways rather
		// than reporting changes through a callback.
		const eventToggles = WEBHOOK_EVENTS.map((event) => ({
			event,
			on: signal(event === "issue.created" || event === "issue.updated"),
		}));
		const selected = derived(
			eventToggles.map((toggle) => toggle.on),
			(...values) => eventToggles.filter((_, index) => values[index]).map((toggle) => toggle.event),
		);
		const busy = signal(false);
		/** Shown once, right after creating — it is never readable again. */
		const freshSecret = signal<string | null>(null);

		const slug = () => store.workspace.get().slug;

		const refresh = async () => {
			hooks.set((await api.webhooks.list(slug())).items);
		};

		const create = async () => {
			if (url.get().trim() === "" || selected.get().length === 0) return;
			busy.set(true);
			try {
				const created = await api.webhooks.create(slug(), {
					url: url.get().trim(),
					events: selected.get(),
				});
				freshSecret.set(created.secret ?? null);
				url.set("");
				await refresh();
			} catch (thrown) {
				toast.add({
					title: "Could not register the webhook",
					description: thrown instanceof ApiError ? thrown.message : "Something went wrong",
					type: "error",
				});
			} finally {
				busy.set(false);
			}
		};

		return SettingsPage(
			"Webhooks",
			"Signed HTTP notifications when things change in this workspace.",

			Implement.Lifecycle({ onMount: () => void refresh() }),

			P(
				{ class: "text-sm text-muted-foreground" },
				"Each delivery carries ",
				Span({ class: "font-mono text-xs" }, "X-Tracker-Signature"),
				" — the HMAC-SHA256 of ",
				Span({ class: "font-mono text-xs" }, "<timestamp>.<body>"),
				" under the endpoint's secret. Delivery is one attempt with no retry.",
			),

				Div(
					{ class: "space-y-3 rounded-md border p-4" },
					Div(
						{ class: "space-y-1.5" },
						Label({ for: "url" }, "Endpoint URL"),
						Input({ id: "url", value: url, placeholder: "https://example.com/hooks/tracker" }),
					),
					Div(
						{ class: "space-y-2" },
						Label("Events"),
						Div(
							{ class: "grid grid-cols-2 gap-2" },
							...eventToggles.map((toggle) =>
								Div(
									{ class: "flex items-center gap-2" },
									Checkbox({ id: toggle.event, checked: toggle.on }),
									Label({ for: toggle.event, class: "font-mono text-xs" }, toggle.event),
								),
							),
						),
					),
					Button({ disabled: busy, onClick: () => void create() }, "Add webhook"),

					If(freshSecret.bind((value) => value !== null)).Then(
						Div(
							{ class: "space-y-1 rounded-md bg-muted p-3" },
							Span(
								{ class: "text-xs font-medium" },
								"Signing secret — copy it now, it is not shown again",
							),
							Div(
								{ class: "font-mono text-xs break-all" },
								freshSecret.bind((value) => value ?? ""),
							),
						),
					),
				),

				Div(
					{ class: "space-y-2" },
					ForEach(
						hooks,
						(hook) => hook.id,
						(hook) =>
							Div(
								{ class: "space-y-2 rounded-md border p-3" },
								Div(
									{ class: "flex items-center gap-2" },
									Span({ class: "min-w-0 flex-1 truncate font-mono text-xs" }, hook.bind("url")),
									Button(
										{
											variant: "outline",
											size: "xs",
											onClick: () =>
												void api.webhooks
													.update(slug(), hook.get().id, { enabled: !hook.get().enabled })
													.then(refresh)
													.catch(() => toast.add({ title: "Could not update", type: "error" })),
										},
										hook.bind((value) => (value.enabled ? "Enabled" : "Disabled")),
									),
									Button(
										{
											variant: "ghost",
											size: "icon-xs",
											"aria-label": "Delete webhook",
											onClick: () =>
												void api.webhooks
													.remove(slug(), hook.get().id)
													.then(refresh)
													.catch(() => toast.add({ title: "Could not delete", type: "error" })),
										},
										TrashIcon({ class: "size-3" }),
									),
								),
								Div(
									{ class: "flex flex-wrap items-center gap-1.5" },
									ForEach(
										hook.bind("events"),
										(event) => event,
										(event) =>
											Badge({ variant: "secondary", class: "font-mono text-[10px]" }, event),
									),
								),
								Div(
									{ class: "text-xs text-muted-foreground" },
									hook.bind((value) =>
										value.lastDeliveredAt === null
											? "No deliveries yet"
											: value.lastError === null
												? `Last delivery ${new Date(value.lastDeliveredAt).toLocaleString()} — ${value.lastStatus}`
												: `Last delivery failed: ${value.lastError}`,
									),
								),
							),
					),
			),
		);
	});
}
