// Webhook management: register an endpoint, see whether it is healthy, send a
// test delivery, and read the delivery log when an integration goes quiet.
import {
	Div,
	ForEach,
	H2,
	If,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	P,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Copy, Plus, Send, Trash2 } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { Label } from "@/lib/components/ui/label";
import type { Webhook, WebhookDelivery } from "@/lib/domain/schemas";
import {
	DEFAULT_WEBHOOK_EVENTS,
	WEBHOOK_EVENT_GROUPS,
	WEBHOOK_EVENT_HINTS,
	WEBHOOK_EVENT_LABELS,
	WEBHOOK_EVENTS,
	type WebhookEvent,
} from "@/lib/domain/webhooks";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const inputClass =
	"h-8 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring";

export function WebhooksSection(slug: Readable<string>, copy: (value: string) => Promise<void>) {
	const hooks = signal<Webhook[]>([]);
	const loading = signal(true);
	const open = signal(false);
	const secret = signal("");

	/** Which webhook's delivery log is expanded, and its rows. */
	const openLog = signal("");
	const deliveries = signal<WebhookDelivery[]>([]);

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/webhooks", {
			params: { slug: slug.get() },
		});
		loading.set(false);
		if (error === undefined) hooks.set(data);
	};

	const remove = async (id: string) => {
		const before = hooks.get();
		hooks.set(before.filter((hook) => hook.id !== id));
		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/webhooks/[id]", {
			params: { slug: slug.get(), id },
		});
		if (error !== undefined) {
			hooks.set(before);
			toastError(messageOf(error, "Could not delete the webhook"));
		}
	};

	const toggle = async (hook: Webhook) => {
		const next = !hook.enabled;
		hooks.set(
			hooks.get().map((entry) => (entry.id === hook.id ? { ...entry, enabled: next } : entry)),
		);
		const { error } = await api.PATCH("/api/v1/workspaces/[slug]/webhooks/[id]", {
			params: { slug: slug.get(), id: hook.id },
			body: { enabled: next },
		});
		if (error !== undefined) {
			hooks.set(
				hooks.get().map((entry) => (entry.id === hook.id ? { ...entry, enabled: !next } : entry)),
			);
			toastError(messageOf(error, "Could not update the webhook"));
		}
	};

	const sendTest = async (id: string) => {
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/webhooks/[id]/test", {
			params: { slug: slug.get(), id },
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not send a test delivery"));
			return;
		}
		if (data.status === "succeeded") toastSuccess(`Delivered (${data.responseStatus ?? 200})`);
		else toastError(`Test failed: ${data.error ?? "no response"}`);

		await load();
		if (openLog.get() === id) await showLog(id);
	};

	const showLog = async (id: string) => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/webhooks/[id]/deliveries", {
			params: { slug: slug.get(), id },
			query: { limit: 10 },
		});
		if (error === undefined) deliveries.set(data);
	};

	const toggleLog = async (id: string) => {
		if (openLog.get() === id) {
			openLog.set("");
			return;
		}
		openLog.set(id);
		deliveries.set([]);
		await showLog(id);
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		ImplementLifecycle({ onMount: () => void load() }),

		Div(
			{ class: "flex items-start justify-between gap-3" },
			Div(
				{},
				H2({ class: "text-[14px] font-semibold" }, "Webhooks"),
				P(
					{ class: "text-[12px] text-muted-foreground" },
					"Get a signed POST whenever something happens in this workspace.",
				),
			),
			Button(
				{ size: "sm", class: "gap-1.5", onClick: () => open.set(true) },
				Plus({ class: "size-3.5" }),
				"Create webhook",
			),
		),

		If(
			secret.bind((value) => value !== ""),
			Div(
				{ class: "rounded-md border border-primary/40 bg-primary/5 p-3" },
				P(
					{ class: "mb-2 text-[12px] font-medium" },
					"Copy this signing secret now. It is not shown again.",
				),
				Div(
					{ class: "flex items-center gap-2" },
					Span({ class: "min-w-0 flex-1 truncate font-mono text-[11px]" }, secret),
					Button(
						{
							size: "icon-sm",
							variant: "ghost",
							title: "Copy secret",
							onClick: () => void copy(secret.get()),
						},
						Copy({ class: "size-3.5" }),
					),
				),
				P(
					{ class: "mt-2 text-[11px] text-muted-foreground" },
					"Every request carries x-tracker-signature: sha256=…, an HMAC of the raw body with this secret.",
				),
			),
		),

		If(
			derived([loading, hooks], (busy, list) => !busy && list.length > 0),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				ForEach(
					hooks,
					(hook) => hook.id,
					(hook) =>
						Div(
							{ class: "flex flex-col" },
							Div(
								{ class: "flex items-center gap-3 px-3 py-2.5" },
								HealthDot(hook),
								Div(
									{ class: "min-w-0 flex-1" },
									Div({ class: "truncate font-mono text-[12px]" }, hook.bind("url")),
									Div(
										{ class: "truncate text-[11px] text-muted-foreground" },
										hook.bind((value) =>
											value.events.map((event) => WEBHOOK_EVENT_LABELS[event]).join(" · "),
										),
									),
								),
								Button(
									{
										size: "sm",
										variant: "ghost",
										class: "text-[12px]",
										onClick: () => void toggleLog(hook.get().id),
									},
									"Deliveries",
								),
								Button(
									{
										size: "icon-sm",
										variant: "ghost",
										title: "Send a test delivery",
										onClick: () => void sendTest(hook.get().id),
									},
									Send({ class: "size-3.5" }),
								),
								Button(
									{
										size: "sm",
										variant: "ghost",
										class: "text-[12px]",
										onClick: () => void toggle(hook.get()),
									},
									hook.bind((value) => (value.enabled ? "Disable" : "Enable")),
								),
								Button(
									{
										size: "icon-sm",
										variant: "ghost",
										title: "Delete",
										onClick: () => void remove(hook.get().id),
									},
									Trash2({ class: "size-3.5" }),
								),
							),

							If(
								derived([openLog], (open) => open === hook.get().id),
								DeliveryLog(deliveries),
							),
						),
				),
			),
		),

		If(
			derived([loading, hooks], (busy, list) => !busy && list.length === 0),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"No webhooks yet. Create one to get a signed POST whenever these events happen.",
			),
		),

		CreateWebhookDialog(open, slug, (created, signingSecret) => {
			hooks.push(created);
			secret.set(signingSecret);
		}),
	);
}

function CreateWebhookDialog(
	open: Signal<boolean>,
	slug: Readable<string>,
	onCreated: (hook: Webhook, secret: string) => void,
) {
	const url = signal("");
	const description = signal("");
	const creating = signal(false);
	const cells = eventCells();
	const chosenCount = signal(DEFAULT_WEBHOOK_EVENTS.length);

	const recount = () => {
		chosenCount.set(
			WEBHOOK_EVENTS.reduce((total, event) => total + (cells[event].get() ? 1 : 0), 0),
		);
	};

	const reset = () => {
		url.set("");
		description.set("");
		for (const event of WEBHOOK_EVENTS) {
			cells[event].set(DEFAULT_WEBHOOK_EVENTS.includes(event));
		}
		recount();
	};

	const setEvent = (event: WebhookEvent, value: boolean) => {
		cells[event].set(value);
		recount();
	};

	const selectAll = () => {
		for (const event of WEBHOOK_EVENTS) cells[event].set(true);
		recount();
	};

	const submit = async () => {
		const target = url.get().trim();
		if (target === "" || chosenCount.get() === 0) return;

		creating.set(true);
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/webhooks", {
			params: { slug: slug.get() },
			body: {
				url: target,
				description: description.get().trim(),
				events: collect(cells),
			},
		});
		creating.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the webhook"));
			return;
		}

		onCreated(data.webhook, data.secret);
		open.set(false);
	};

	return Dialog(
		{ open },
		ImplementEffect([open], (isOpen) => {
			if (isOpen) reset();
		}),
		DialogContent(
			{ class: "max-w-md gap-0 p-0" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle({ class: "text-[15px] font-semibold" }, "Create webhook"),
				DialogDescription({ class: "text-[12px]" }, "Where to POST, and which events to send."),
			),

			Div(
				{ class: "flex flex-col gap-4 px-4 py-4" },
				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ for: "webhook-url", class: "text-[13px]" }, "URL"),
					Input({
						id: "webhook-url",
						value: url,
						type: "url",
						placeholder: "https://example.com/hooks/tracker",
						autofocus: true,
						class: inputClass,
						onKeydown: (event) => {
							if (event.key === "Enter") void submit();
						},
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ for: "webhook-description", class: "text-[13px]" }, "Description"),
					Input({
						id: "webhook-description",
						value: description,
						placeholder: "What is this for? (optional)",
						class: inputClass,
						onKeydown: (event) => {
							if (event.key === "Enter") void submit();
						},
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Div(
						{ class: "flex items-center justify-between gap-2" },
						Span({ class: "text-[13px] font-medium" }, "Events"),
						Button(
							{
								size: "xs",
								variant: "ghost",
								type: "button",
								class: "text-[11px] text-muted-foreground",
								onClick: selectAll,
							},
							"Select all",
						),
					),
					Div(
						{
							class: "flex max-h-64 flex-col overflow-y-auto rounded-md border border-border",
						},
						...WEBHOOK_EVENT_GROUPS.flatMap((group, index) => [
							Div(
								{
									class: cn(
										"sticky top-0 bg-secondary/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm",
										index > 0 && "border-t border-border",
									),
								},
								group.label,
							),
							...group.events.map((event) =>
								Div(
									{
										class: "flex items-start gap-2.5 px-3 py-2",
									},
									Checkbox({
										id: `webhook-event-${event}`,
										checked: cells[event],
										"aria-label": WEBHOOK_EVENT_LABELS[event],
										onCheckedChange: (value) => setEvent(event, value),
									}),
									Label(
										{
											for: `webhook-event-${event}`,
											class: "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5",
										},
										Span({ class: "text-[13px] font-normal" }, WEBHOOK_EVENT_LABELS[event]),
										Span(
											{ class: "text-[11px] font-normal text-muted-foreground" },
											WEBHOOK_EVENT_HINTS[event],
										),
									),
								),
							),
						]),
					),
				),
			),

			Div(
				{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
				Span(
					{ class: "mr-auto text-[11px] text-muted-foreground" },
					chosenCount.bind((count) =>
						count === 0 ? "Choose at least one event" : `${count} selected`,
					),
				),
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						loading: creating,
						disabled: derived(
							[url, chosenCount],
							(value, count) => value.trim() === "" || count === 0,
						),
						onClick: () => void submit(),
					},
					"Create webhook",
				),
			),
		),
	);
}

type EventCells = Record<WebhookEvent, Signal<boolean>>;

function eventCells(): EventCells {
	return Object.fromEntries(
		WEBHOOK_EVENTS.map((event) => [event, signal(DEFAULT_WEBHOOK_EVENTS.includes(event))]),
	) as EventCells;
}

function collect(cells: EventCells): WebhookEvent[] {
	return WEBHOOK_EVENTS.filter((event) => cells[event].get());
}

/** Green when the last delivery landed, red when it did not, grey when unused. */
function HealthDot(hook: Readable<Webhook>) {
	return Span({
		class: hook.bind((value) =>
			cn(
				"size-2 shrink-0 rounded-full",
				!value.enabled
					? "bg-muted-foreground/40"
					: value.lastDeliveryStatus === "succeeded"
						? "bg-green-500"
						: value.lastDeliveryStatus === null
							? "bg-muted-foreground/40"
							: "bg-destructive",
			),
		),
		title: hook.bind((value) =>
			!value.enabled
				? "Disabled"
				: value.failingSince !== null
					? `Failing since ${relativeTime(value.failingSince)} ago`
					: value.lastDeliveryAt === null
						? "No deliveries yet"
						: `Last delivery ${relativeTime(value.lastDeliveryAt)} ago`,
		),
	});
}

function DeliveryLog(deliveries: Readable<WebhookDelivery[]>) {
	return Div(
		{ class: "border-t border-border bg-secondary/30 px-3 py-2" },
		If(
			deliveries.bind((list) => list.length === 0),
			P({ class: "py-1 text-[11px] text-muted-foreground" }, "No deliveries recorded yet."),
		),
		ForEach(
			deliveries,
			(delivery) => delivery.id,
			(delivery) =>
				Div(
					{ class: "flex items-center gap-3 py-1 text-[11px]" },
					Span(
						{
							class: delivery.bind((value) =>
								cn(
									"w-16 shrink-0 font-medium",
									value.status === "succeeded"
										? "text-green-500"
										: value.status === "failed"
											? "text-destructive"
											: "text-muted-foreground",
								),
							),
						},
						delivery.bind("status"),
					),
					Span({ class: "w-40 shrink-0 font-mono text-muted-foreground" }, delivery.bind("event")),
					Span(
						{ class: "min-w-0 flex-1 truncate text-muted-foreground" },
						delivery.bind(
							(value) =>
								value.error ??
								(value.responseStatus === null ? "" : `HTTP ${value.responseStatus}`),
						),
					),
					Span(
						{ class: "shrink-0 text-muted-foreground" },
						delivery.bind((value) => (value.attempts > 1 ? `${value.attempts} attempts` : "")),
					),
					Span(
						{ class: "w-10 shrink-0 text-right text-muted-foreground" },
						delivery.bind((value) => relativeTime(value.createdAt)),
					),
				),
		),
	);
}
