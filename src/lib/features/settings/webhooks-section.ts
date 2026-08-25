// Webhook management: register an endpoint, see whether it is healthy, send a
// test delivery, and read the delivery log when an integration goes quiet.
//
// The dialog does double duty. Creating and editing differ only in which verb
// they end in and whether the URL is still settable, and keeping them one
// component is what stops the events list, the headers and the conditions from
// drifting between the two.
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
import { Copy, Pencil, Plus, Send, Trash2, Webhook as WebhookIcon } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/ui/empty";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { Label } from "@/lib/components/ui/label";
import type { Webhook, WebhookDelivery } from "@/lib/domain/schemas";
import { describeFilter, type FilterMatch } from "@/lib/domain/webhook-filters";
import {
	DEFAULT_WEBHOOK_EVENTS,
	MAX_CUSTOM_HEADERS,
	validateHeaders,
	WEBHOOK_EVENT_GROUPS,
	WEBHOOK_EVENT_HINTS,
	WEBHOOK_EVENT_LABELS,
	WEBHOOK_EVENTS,
	type WebhookEvent,
} from "@/lib/domain/webhooks";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fromBuilder, toBuilder, type BuilderNode } from "./webhook-builder";
import { ConditionsEditor } from "./webhook-conditions";

const inputClass =
	"h-8 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring";

export function WebhooksSection(slug: Readable<string>, copy: (value: string) => Promise<void>) {
	const hooks = signal<Webhook[]>([]);
	const loading = signal(true);
	const open = signal(false);
	const secret = signal("");
	/** The webhook the dialog is editing, or null when it is creating one. */
	const editing = signal<Webhook | null>(null);

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

	const edit = (hook: Webhook) => {
		editing.set(hook);
		open.set(true);
	};

	const create = () => {
		editing.set(null);
		open.set(true);
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
				{ size: "sm", class: "gap-1.5", onClick: create },
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
									ConditionSummary(hook),
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
										size: "icon-sm",
										variant: "ghost",
										title: "Edit",
										onClick: () => edit(hook.get()),
									},
									Pencil({ class: "size-3.5" }),
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
			Empty(
				{ class: "border md:p-8" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, WebhookIcon({ "aria-hidden": true })),
					EmptyTitle("No webhooks yet"),
					EmptyDescription("Create one to get a signed POST whenever these events happen."),
				),
			),
		),

		WebhookDialog(open, slug, editing, (saved, signingSecret) => {
			if (signingSecret === null) {
				hooks.set(hooks.get().map((entry) => (entry.id === saved.id ? saved : entry)));
				return;
			}
			hooks.push(saved);
			secret.set(signingSecret);
		}),
	);
}

/** The conditions line under a webhook, so the list says what it actually sends. */
function ConditionSummary(hook: Readable<Webhook>) {
	const summary = hook.bind((value) => describeFilter(value.filter));
	const headerCount = hook.bind((value) => Object.keys(value.headers).length);

	return Div(
		{ class: "flex min-w-0 items-center gap-2" },
		If(
			summary.bind((text) => text !== ""),
			Span(
				{ class: "truncate text-[11px] text-muted-foreground" },
				Span({ class: "text-foreground/70" }, "when "),
				summary,
			),
		),
		If(
			headerCount.bind((count) => count > 0),
			Span(
				{ class: "shrink-0 text-[11px] text-muted-foreground" },
				headerCount.bind((count) => `${count} custom header${count === 1 ? "" : "s"}`),
			),
		),
	);
}

// ---------------------------------------------------------------------------
// The create / edit dialog
// ---------------------------------------------------------------------------

interface HeaderRow {
	id: string;
	name: string;
	value: string;
}

let headerCounter = 0;
const newHeaderRow = (name = "", value = ""): HeaderRow => ({
	id: `header-${(headerCounter += 1)}`,
	name,
	value,
});

/** The rows as a header map, or the first thing wrong with them. */
function collectHeaders(rows: HeaderRow[]): {
	headers: Record<string, string>;
	error: string | null;
} {
	const headers: Record<string, string> = {};
	for (const row of rows) {
		const name = row.name.trim();
		// A blank row is someone who clicked "Add header" and changed their mind.
		if (name === "" && row.value.trim() === "") continue;
		if (name === "") return { headers, error: "a header needs a name" };
		if (Object.keys(headers).some((existing) => existing.toLowerCase() === name.toLowerCase())) {
			return { headers, error: `${name} is set twice` };
		}
		headers[name] = row.value;
	}
	return { headers, error: validateHeaders(headers) };
}

function WebhookDialog(
	open: Signal<boolean>,
	slug: Readable<string>,
	editing: Readable<Webhook | null>,
	onSaved: (hook: Webhook, secret: string | null) => void,
) {
	const url = signal("");
	const description = signal("");
	const saving = signal(false);
	const cells = eventCells();
	const chosen = signal<WebhookEvent[]>([...DEFAULT_WEBHOOK_EVENTS]);
	const headers = signal<HeaderRow[]>([]);
	const match = signal<FilterMatch>("all");
	const rules = signal<BuilderNode[]>([]);

	const recount = () => chosen.set(collect(cells));

	const reset = () => {
		const hook = editing.get();
		url.set(hook?.url ?? "");
		description.set(hook?.description ?? "");
		for (const event of WEBHOOK_EVENTS) {
			cells[event].set(
				hook === null ? DEFAULT_WEBHOOK_EVENTS.includes(event) : hook.events.includes(event),
			);
		}
		recount();

		headers.set(
			Object.entries(hook?.headers ?? {}).map(([name, value]) => newHeaderRow(name, value)),
		);

		const builder = toBuilder(hook?.filter ?? null);
		match.set(builder.match);
		rules.set(builder.rules);
	};

	const submit = async () => {
		const target = url.get().trim();
		const hook = editing.get();
		if (chosen.get().length === 0) return;
		if (hook === null && target === "") return;

		const { headers: collected, error: headerError } = collectHeaders(headers.get());
		if (headerError !== null) {
			toastError(headerError);
			return;
		}

		const filter = fromBuilder(match.get(), rules.get());

		saving.set(true);
		const result =
			hook === null
				? await api.POST("/api/v1/workspaces/[slug]/webhooks", {
						params: { slug: slug.get() },
						body: {
							url: target,
							description: description.get().trim(),
							events: chosen.get(),
							headers: collected,
							filter,
						},
					})
				: await api.PATCH("/api/v1/workspaces/[slug]/webhooks/[id]", {
						params: { slug: slug.get(), id: hook.id },
						body: {
							description: description.get().trim(),
							events: chosen.get(),
							headers: collected,
							filter,
						},
					});
		saving.set(false);

		if (result.error !== undefined) {
			toastError(
				messageOf(
					result.error,
					hook === null ? "Could not create the webhook" : "Could not save the webhook",
				),
			);
			return;
		}

		if (hook === null) {
			const created = result.data as { webhook: Webhook; secret: string };
			onSaved(created.webhook, created.secret);
		} else {
			onSaved(result.data as Webhook, null);
		}
		open.set(false);
	};

	const isEdit = editing.bind((hook) => hook !== null);

	return Dialog(
		{ open },
		ImplementEffect([open], (isOpen) => {
			if (isOpen) reset();
		}),
		DialogContent(
			{ class: "flex max-h-[85vh] max-w-lg flex-col gap-0 p-0" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle(
					{ class: "text-[15px] font-semibold" },
					isEdit.bind((editing) => (editing ? "Edit webhook" : "Create webhook")),
				),
				DialogDescription(
					{ class: "text-[12px]" },
					"Where to POST, which events to send, and when.",
				),
			),

			Div(
				{ class: "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" },
				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ for: "webhook-url", class: "text-[13px]" }, "URL"),
					Input({
						id: "webhook-url",
						value: url,
						type: "url",
						placeholder: "https://example.com/hooks/tracker",
						autofocus: true,
						// The URL is what the signing secret was issued against, so it
						// is fixed once the webhook exists — make a new one instead.
						disabled: isEdit,
						class: cn(inputClass, "disabled:opacity-60"),
						onKeydown: (event) => {
							if (event.key === "Enter") void submit();
						},
					}),
					If(
						isEdit,
						P(
							{ class: "text-[11px] text-muted-foreground" },
							"The URL is fixed once a webhook exists. Create a new one to point somewhere else.",
						),
					),
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

				EventPicker(cells, recount),
				HeadersEditor(headers),
				ConditionsEditor(match, rules, chosen),
			),

			Div(
				{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
				Span(
					{ class: "mr-auto text-[11px] text-muted-foreground" },
					chosen.bind((events) =>
						events.length === 0 ? "Choose at least one event" : `${events.length} events`,
					),
				),
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						loading: saving,
						disabled: derived(
							[url, chosen, isEdit],
							(value, events, editing) => events.length === 0 || (!editing && value.trim() === ""),
						),
						onClick: () => void submit(),
					},
					isEdit.bind((editing) => (editing ? "Save changes" : "Create webhook")),
				),
			),
		),
	);
}

function EventPicker(cells: EventCells, recount: () => void) {
	const selectAll = () => {
		for (const event of WEBHOOK_EVENTS) cells[event].set(true);
		recount();
	};

	const setEvent = (event: WebhookEvent, value: boolean) => {
		cells[event].set(value);
		recount();
	};

	return Div(
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
			{ class: "flex max-h-64 flex-col overflow-y-auto rounded-md border border-border" },
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
						{ class: "flex items-start gap-2.5 px-3 py-2" },
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
	);
}

/**
 * Extra headers on every delivery — a bearer token for whatever sits in front
 * of the receiver, a tenant id, a routing key. The pipeline's own headers are
 * not editable here; they always win at send time.
 */
function HeadersEditor(headers: Signal<HeaderRow[]>) {
	const full = headers.bind((rows) => rows.length >= MAX_CUSTOM_HEADERS);

	return Div(
		{ class: "flex flex-col gap-1.5" },
		Div(
			{ class: "flex items-center justify-between gap-2" },
			Span({ class: "text-[13px] font-medium" }, "Custom headers"),
			Span(
				{ class: "text-[11px] text-muted-foreground" },
				headers.bind((rows) =>
					rows.length === 0 ? "" : `${rows.length} of ${MAX_CUSTOM_HEADERS}`,
				),
			),
		),

		If(
			headers.bind((rows) => rows.length > 0),
			Div(
				{ class: "flex flex-col gap-1.5" },
				ForEach(
					headers,
					(row) => row.id,
					(row) =>
						Div(
							{ class: "flex items-center gap-1.5" },
							Input({
								value: row.bind("name"),
								placeholder: "Authorization",
								spellcheck: false,
								autocapitalize: "off",
								"aria-label": "Header name",
								class: cn(inputClass, "w-[9rem] shrink-0 font-mono text-[12px]"),
							}),
							Input({
								value: row.bind("value"),
								placeholder: "Bearer …",
								spellcheck: false,
								autocapitalize: "off",
								"aria-label": "Header value",
								class: cn(inputClass, "min-w-0 flex-1 font-mono text-[12px]"),
							}),
							Button(
								{
									size: "icon-sm",
									variant: "ghost",
									type: "button",
									title: "Remove header",
									onClick: () =>
										headers.update((rows) => rows.filter((entry) => entry.id !== row.get().id)),
								},
								Trash2({ class: "size-3.5" }),
							),
						),
				),
			),
		),

		Div(
			{ class: "flex items-center gap-2" },
			Button(
				{
					size: "xs",
					variant: "outline",
					type: "button",
					class: "gap-1 text-[11px]",
					disabled: full,
					onClick: () => headers.push(newHeaderRow()),
				},
				Plus({ class: "size-3" }),
				"Add header",
			),
			Span(
				{ class: "text-[11px] text-muted-foreground" },
				"Sent with every delivery. Values are readable by workspace admins.",
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
			Empty(
				{ class: "p-4 md:p-4" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, Send({ "aria-hidden": true })),
					EmptyTitle("No deliveries yet"),
					EmptyDescription("A test send or a live event will show up here."),
				),
			),
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
