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
import {
	ArrowRight,
	Ban,
	ChevronDown,
	Copy,
	Ellipsis,
	Pencil,
	Plus,
	Power,
	RotateCw,
	Send,
	SquareTerminal,
	Trash2,
	Webhook as WebhookIcon,
} from "@implementjs/lucide";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { Label } from "@/lib/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group";
import { Textarea } from "@/lib/components/ui/textarea";
// `Label` is the form-control component in this file; the domain type is the
// issue label, so it comes in under a name that says which.
import type {
	Label as IssueLabel,
	Member,
	Repository,
	Team,
	Webhook,
	WebhookDelivery,
	WebhookDeliveryDetail,
} from "@/lib/domain/schemas";
import { describeFilter, type FilterMatch } from "@/lib/domain/webhook-filters";
import {
	DEFAULT_WEBHOOK_EVENTS,
	DEFAULT_WEBHOOK_FORMAT,
	MAX_CUSTOM_HEADERS,
	validateHeaders,
	WEBHOOK_EVENT_GROUPS,
	WEBHOOK_EVENT_HINTS,
	WEBHOOK_EVENT_LABELS,
	WEBHOOK_EVENTS,
	WEBHOOK_FORMAT_HINTS,
	WEBHOOK_FORMAT_LABELS,
	WEBHOOK_FORMATS,
	type WebhookEvent,
	type WebhookFormat,
} from "@/lib/domain/webhooks";
import {
	renderTemplate,
	SAMPLE_EVENT,
	segmentTemplate,
	suggestTemplatePaths,
	validateTemplate,
} from "@/lib/domain/webhook-templates";
import { fullTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fromBuilder, toBuilder, type BuilderNode } from "./webhook-builder";
import { ConditionsEditor, emptyCatalog, type ConditionCatalog } from "./webhook-conditions";

const inputClass =
	"h-8 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring";

export function WebhooksSection(slug: Readable<string>, copy: (value: string) => Promise<void>) {
	const hooks = signal<Webhook[]>([]);
	const loading = signal(true);
	const open = signal(false);
	const secret = signal("");
	/** The webhook the dialog is editing, or null when it is creating one. */
	const editing = signal<Webhook | null>(null);

	/**
	 * The workspace's own values, so a condition on an assignee or a label is
	 * picked rather than typed. Loaded once with the webhooks — every one of
	 * these is a small list, and the builder is unusable without them.
	 */
	const catalog = signal<ConditionCatalog>(emptyCatalog());

	const load = async () => {
		const workspaceSlug = slug.get();
		const [hookResult, memberResult, labelResult, teamResult, repositoryResult] = await Promise.all(
			[
				api.GET("/api/v1/workspaces/[slug]/webhooks", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/members", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/labels", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/teams", { params: { slug: workspaceSlug } }),
				api.GET("/api/v1/workspaces/[slug]/repositories", { params: { slug: workspaceSlug } }),
			],
		);
		loading.set(false);
		if (hookResult.error === undefined) hooks.set(hookResult.data);

		// A workspace without repositories, or a member who cannot list them, is
		// not an error here — that field simply offers nothing to pick.
		catalog.set({
			members: memberResult.error === undefined ? (memberResult.data as Member[]) : [],
			labels: labelResult.error === undefined ? (labelResult.data as IssueLabel[]) : [],
			teams: teamResult.error === undefined ? (teamResult.data as Team[]) : [],
			repositories:
				repositoryResult.error === undefined ? (repositoryResult.data as Repository[]) : [],
		});
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
							{ class: "flex items-center gap-3 px-3 py-2.5" },
							// The row is the way in; everything else hides behind the
							// ellipsis so the list reads as a list, not a toolbar.
							Div(
								{
									class: "flex min-w-0 flex-1 cursor-pointer items-center gap-3",
									title: "Open this webhook",
									onClick: () => edit(hook.get()),
								},
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
							),
							DropdownMenu(
								DropdownMenuTrigger(
									{ size: "icon-sm", variant: "ghost", title: "Webhook actions" },
									Ellipsis({ class: "size-3.5" }),
								),
								DropdownMenuContent(
									{ class: "min-w-36", align: "end" },
									DropdownMenuItem(
										{ onSelect: () => edit(hook.get()) },
										Pencil({ class: "size-3.5" }),
										"Edit",
									),
									DropdownMenuItem(
										{ onSelect: () => void toggle(hook.get()) },
										If(
											hook.bind((value) => value.enabled),
											Ban({ class: "size-3.5" }),
										),
										If(
											hook.bind((value) => !value.enabled),
											Power({ class: "size-3.5" }),
										),
										hook.bind((value) => (value.enabled ? "Disable" : "Enable")),
									),
									DropdownMenuItem(
										{ onSelect: () => void remove(hook.get().id) },
										Trash2({ class: "size-3.5" }),
										"Delete",
									),
								),
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

		WebhookDialog(
			open,
			slug,
			editing,
			catalog,
			copy,
			// Deliveries sent from inside the dialog move the health dots out here.
			() => void load(),
			(saved, signingSecret) => {
				if (signingSecret === null) {
					hooks.set(hooks.get().map((entry) => (entry.id === saved.id ? saved : entry)));
					return;
				}
				hooks.push(saved);
				secret.set(signingSecret);
			},
		),
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
		If(
			hook.bind((value) => value.format !== "json"),
			Span(
				{ class: "shrink-0 text-[11px] text-muted-foreground" },
				hook.bind((value) => WEBHOOK_FORMAT_LABELS[value.format]),
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

/** The dialog's two faces: the form, and the delivery log behind it. */
type DialogTab = "overview" | "deliveries";

function WebhookDialog(
	open: Signal<boolean>,
	slug: Readable<string>,
	editing: Readable<Webhook | null>,
	catalog: Readable<ConditionCatalog>,
	copy: (value: string) => Promise<void>,
	onDelivered: () => void,
	onSaved: (hook: Webhook, secret: string | null) => void,
) {
	const url = signal("");
	const description = signal("");
	const saving = signal(false);
	const cells = eventCells();
	const chosen = signal<WebhookEvent[]>([...DEFAULT_WEBHOOK_EVENTS]);
	const headers = signal<HeaderRow[]>([]);
	// `string | null` because that is what the radio primitive binds; narrowed
	// back to the picklist at submit time.
	const format = signal<string | null>(DEFAULT_WEBHOOK_FORMAT);
	const template = signal("");
	const match = signal<FilterMatch>("all");
	const rules = signal<BuilderNode[]>([]);

	const tab = signal<DialogTab>("overview");
	const deliveries = signal<WebhookDelivery[]>([]);
	const deliveriesLoaded = signal(false);
	/** Which delivery is expanded, and its full record. */
	const openDelivery = signal("");
	const detail = signal<WebhookDeliveryDetail | null>(null);
	const testing = signal(false);

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
		format.set(hook?.format ?? DEFAULT_WEBHOOK_FORMAT);
		template.set(hook?.template ?? "");

		const builder = toBuilder(hook?.filter ?? null);
		match.set(builder.match);
		rules.set(builder.rules);

		tab.set("overview");
		deliveries.set([]);
		deliveriesLoaded.set(false);
		openDelivery.set("");
		detail.set(null);
	};

	const refreshDeliveries = async () => {
		const hook = editing.get();
		if (hook === null) return;
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/webhooks/[id]/deliveries", {
			params: { slug: slug.get(), id: hook.id },
			query: { limit: 25 },
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not load the deliveries"));
			return;
		}
		deliveries.set(data);
		deliveriesLoaded.set(true);
	};

	const showTab = (next: DialogTab) => {
		tab.set(next);
		if (next === "deliveries") void refreshDeliveries();
	};

	const fetchDetail = async (deliveryId: string) => {
		const hook = editing.get();
		if (hook === null) return;
		const { data, error } = await api.GET(
			"/api/v1/workspaces/[slug]/webhooks/[id]/deliveries/[deliveryId]",
			{ params: { slug: slug.get(), id: hook.id, deliveryId } },
		);
		if (error !== undefined) {
			openDelivery.set("");
			toastError(messageOf(error, "Could not load the delivery"));
			return;
		}
		// A slow response must not land under whichever row is open by then.
		if (openDelivery.get() === deliveryId) detail.set(data);
	};

	const toggleDetail = async (deliveryId: string) => {
		if (openDelivery.get() === deliveryId) {
			openDelivery.set("");
			return;
		}
		openDelivery.set(deliveryId);
		detail.set(null);
		await fetchDetail(deliveryId);
	};

	/** Sends a settled delivery again, then refreshes whatever is showing it. */
	const retry = async (deliveryId: string) => {
		const hook = editing.get();
		if (hook === null) return;
		const { data, error } = await api.POST(
			"/api/v1/workspaces/[slug]/webhooks/[id]/deliveries/[deliveryId]/redeliver",
			{ params: { slug: slug.get(), id: hook.id, deliveryId } },
		);
		if (error !== undefined) {
			toastError(messageOf(error, "Could not resend the delivery"));
			return;
		}
		if (data.status === "succeeded") toastSuccess(`Delivered (${data.responseStatus ?? 200})`);
		else toastError(`Resend failed: ${data.error ?? "no response"}`);

		onDelivered();
		await refreshDeliveries();
		if (openDelivery.get() === deliveryId) await fetchDetail(deliveryId);
	};

	const sendTest = async () => {
		const hook = editing.get();
		if (hook === null) return;
		testing.set(true);
		const { data, error } = await api.POST("/api/v1/workspaces/[slug]/webhooks/[id]/test", {
			params: { slug: slug.get(), id: hook.id },
		});
		testing.set(false);
		if (error !== undefined) {
			toastError(messageOf(error, "Could not send a test delivery"));
			return;
		}
		if (data.status === "succeeded") toastSuccess(`Delivered (${data.responseStatus ?? 200})`);
		else toastError(`Test failed: ${data.error ?? "no response"}`);

		onDelivered();
		if (deliveriesLoaded.get()) await refreshDeliveries();
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
		const payloadFormat = asFormat(format.get());
		const templateText = template.get().trim() === "" ? null : template.get();
		if (payloadFormat === "custom") {
			const problem =
				templateText === null
					? "a custom format needs a template body"
					: validateTemplate(templateText);
			if (problem !== null) {
				toastError(problem);
				return;
			}
		}

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
							format: payloadFormat,
							template: templateText,
						},
					})
				: await api.PATCH("/api/v1/workspaces/[slug]/webhooks/[id]", {
						params: { slug: slug.get(), id: hook.id },
						body: {
							description: description.get().trim(),
							events: chosen.get(),
							headers: collected,
							filter,
							format: payloadFormat,
							template: templateText,
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
			// Wide, because the events list and the condition chips are both
			// horizontal things that were being wrapped to death in a narrow column.
			// `sm:` prefixed, because the dialog's own default is `sm:max-w-lg` and
			// an unprefixed `max-w-*` does not override a responsive one.
			{ class: "flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 pt-3" },
				DialogTitle(
					{ class: "text-[15px] font-semibold" },
					isEdit.bind((editing) => (editing ? "Edit webhook" : "Create webhook")),
				),
				DialogDescription(
					{ class: "text-[12px]" },
					"Where to POST, which events to send, and when.",
				),
				// A webhook that exists has a past worth reading; one being created
				// does not, so the tabs only show up in edit mode.
				If(
					isEdit,
					Div(
						{ class: "-mb-px mt-2 flex gap-4", role: "tablist", "aria-label": "Webhook views" },
						DialogTabButton(tab, "overview", "Overview", showTab),
						DialogTabButton(tab, "deliveries", "Deliveries", showTab),
					),
				),
				If(
					isEdit.bind((editing) => !editing),
					Div({ class: "pb-3" }),
				),
			),

			If(
				tab.bind((current) => current === "overview"),
				OverviewTab(),
			),
			If(
				derived([tab, isEdit], (current, editing) => editing && current === "deliveries"),
				DeliveriesTab(),
			),
		),
	);

	function OverviewTab() {
		return Div(
			{ class: "flex min-h-0 flex-1 flex-col" },
			Div(
				{
					class:
						"grid min-h-0 flex-1 gap-x-6 gap-y-4 overflow-y-auto px-4 py-4 md:grid-cols-[minmax(0,1fr)_18rem]",
				},
				Div(
					{ class: "flex flex-col gap-1.5 md:col-start-1" },
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
					{ class: "flex flex-col gap-1.5 md:col-start-1" },
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

				// Events sit in their own column and stay put while the left side
				// grows; headers and conditions want the width the rail leaves.
				Div({ class: "md:col-start-2 md:row-span-5 md:row-start-1" }, EventPicker(cells, recount)),
				Div({ class: "md:col-start-1" }, FormatPicker(format, template)),
				Div({ class: "md:col-start-1" }, HeadersEditor(headers)),
				Div({ class: "md:col-start-1" }, ConditionsEditor(match, rules, chosen, catalog)),
			),

			Div(
				{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
				Div(
					{ class: "mr-auto flex items-center gap-3" },
					If(
						isEdit,
						Button(
							{
								size: "sm",
								variant: "outline",
								type: "button",
								class: "gap-1.5 text-[12px]",
								loading: testing,
								onClick: () => void sendTest(),
							},
							Send({ class: "size-3.5" }),
							"Send test delivery",
						),
					),
					Span(
						{ class: "text-[11px] text-muted-foreground" },
						chosen.bind((events) =>
							events.length === 0 ? "Choose at least one event" : `${events.length} events`,
						),
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
		);
	}

	function DeliveriesTab() {
		return Div(
			{ class: "flex min-h-0 flex-1 flex-col" },
			Div(
				{ class: "min-h-0 flex-1 overflow-y-auto" },
				DeliveryList(deliveries, deliveriesLoaded, openDelivery, detail, editing, {
					toggleDetail: (deliveryId) => void toggleDetail(deliveryId),
					retry: (deliveryId) => void retry(deliveryId),
					copy,
				}),
			),
			Div(
				{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Close"),
			),
		);
	}
}

/** One underline tab in the dialog header, the shape the mockup draws. */
function DialogTabButton(
	tab: Readable<DialogTab>,
	value: DialogTab,
	label: string,
	onSelect: (tab: DialogTab) => void,
) {
	const active = tab.bind((current) => current === value);
	return Div(
		{
			role: "tab",
			tabIndex: 0,
			"aria-selected": active,
			class: active.bind((on) =>
				cn(
					"-mb-px cursor-pointer border-b-2 px-1 pb-2 text-[13px] font-medium select-none",
					on
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				),
			),
			onClick: () => onSelect(value),
			onKeydown: (event) => {
				if (event.key === "Enter" || event.key === " ") onSelect(value);
			},
		},
		label,
	);
}

/** The picker's string, narrowed back to the picklist. */
const asFormat = (value: string | null): WebhookFormat =>
	value === "text" || value === "custom" ? value : "json";

/**
 * How the body is shaped. Most receivers want the JSON event; the text wrapper
 * exists for endpoints that take freeform text and hand it to an agent — a
 * Claude Code routine's API trigger, a Slack incoming webhook — and the custom
 * template for endpoints that dictate their own body shape.
 */
function FormatPicker(format: Signal<string | null>, template: Signal<string>) {
	return Div(
		{ class: "flex flex-col gap-1.5" },
		Span({ class: "text-[13px] font-medium" }, "Payload format"),
		RadioGroup(
			{
				value: format,
				onValueChange: (next) => {
					if (typeof next !== "string") return;
					format.set(next);
					// Seed an empty editor so picking "custom" shows something that
					// already works rather than a blank box and a validation error.
					if (next === "custom" && template.get().trim() === "") {
						template.set('{\n\t"text": "{{summary}}"\n}');
					}
				},
				class: "flex flex-col gap-0 rounded-md border border-border",
			},
			...WEBHOOK_FORMATS.map((entry, index) =>
				Div(
					{
						class: cn("flex items-start gap-2.5 px-3 py-2", index > 0 && "border-t border-border"),
					},
					RadioGroupItem({ id: `webhook-format-${entry}`, value: entry, class: "mt-0.5" }),
					Label(
						{
							for: `webhook-format-${entry}`,
							class: "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5",
						},
						Span({ class: "text-[13px] font-normal" }, WEBHOOK_FORMAT_LABELS[entry]),
						Span(
							{ class: "text-[11px] font-normal text-muted-foreground" },
							WEBHOOK_FORMAT_HINTS[entry],
						),
					),
				),
			),
		),
		If(
			format.bind((value) => value === "custom"),
			TemplateEditor(template),
		),
	);
}

const TEMPLATE_EDITOR_ID = "webhook-template-editor";
const TEMPLATE_OVERLAY_ID = "webhook-template-overlay";

const segmentClass = (kind: string) =>
	cn(
		kind === "known" && "font-medium text-primary",
		kind === "unknown" && "text-amber-600 underline decoration-dotted dark:text-amber-500",
	);

/** What the caret is in the middle of completing, or null when idle. */
interface CompletionState {
	/** Where the partly-typed path begins in the template. */
	start: number;
	token: string;
	/** How many braces opened the placeholder — 2 escaped, 3 raw. */
	opens: number;
}

/**
 * The custom body, edited with highlighting, path completion, and a live
 * preview, so quoting mistakes and typo'd paths surface while typing rather
 * than as a failed delivery. The preview renders the same sample event the
 * server validates against.
 *
 * Highlighting is the classic overlay trick: the textarea's own text is
 * transparent (the caret is not), and a pointer-transparent layer behind it
 * renders the same characters with the placeholders tinted. The two stay
 * aligned because they share font, padding, wrapping, and scroll offsets.
 */
function TemplateEditor(template: Signal<string>) {
	const preview = template.bind((value) => {
		const problem =
			value.trim() === "" ? "a custom format needs a template body" : validateTemplate(value);
		if (problem !== null) return { ok: false, text: problem };
		return { ok: true, text: renderTemplate(value, SAMPLE_EVENT) };
	});

	const segments = template.bind((value) =>
		segmentTemplate(value).map((segment, index) => ({
			...segment,
			// Content in the key on purpose: segments have no identity across
			// edits, so an edited run must remount rather than patch a neighbor.
			key: `${index}:${segment.kind}:${segment.text}`,
		})),
	);

	const completion = signal<CompletionState | null>(null);
	const menuIndex = signal(0);
	const matches = derived([completion], (state) =>
		state === null ? [] : suggestTemplatePaths(state.token),
	);

	const editorElement = (): HTMLTextAreaElement | null =>
		document.getElementById(TEMPLATE_EDITOR_ID) as HTMLTextAreaElement | null;

	/** Re-derive the completion context from wherever the caret now sits. */
	const refreshCompletion = () => {
		const element = editorElement();
		if (element === null || element.selectionStart !== element.selectionEnd) {
			completion.set(null);
			return;
		}
		const caret = element.selectionStart ?? 0;
		const opened = /(\{\{\{?)\s*([\w.]*)$/.exec(element.value.slice(0, caret));
		if (opened === null) {
			completion.set(null);
			return;
		}
		const token = opened[2] ?? "";
		const state: CompletionState = {
			start: caret - token.length,
			token,
			opens: (opened[1] ?? "{{").length,
		};
		const previous = completion.get();
		if (previous === null || previous.start !== state.start || previous.token !== state.token) {
			menuIndex.set(0);
			completion.set(state);
		}
	};

	const accept = (path: string) => {
		const element = editorElement();
		const state = completion.get();
		if (element === null || state === null) return;

		const value = element.value;
		const caretBefore = element.selectionStart ?? state.start + state.token.length;
		const after = value.slice(caretBefore);
		// Only add the closers the person has not already typed.
		const closersPresent = (/^\}{0,3}/.exec(after)?.[0] ?? "").length;
		const closersNeeded = Math.max(0, state.opens - closersPresent);

		template.set(value.slice(0, state.start) + path + "}".repeat(closersNeeded) + after);
		completion.set(null);

		const caretAfter = state.start + path.length + closersNeeded + closersPresent;
		requestAnimationFrame(() => {
			const restored = editorElement();
			restored?.focus();
			restored?.setSelectionRange(caretAfter, caretAfter);
		});
	};

	const onKeydown = (event: KeyboardEvent) => {
		const list = matches.get();
		if (completion.get() === null || list.length === 0) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			menuIndex.set((menuIndex.get() + 1) % list.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			menuIndex.set((menuIndex.get() - 1 + list.length) % list.length);
		} else if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			accept(list[menuIndex.get()]!.path);
		} else if (event.key === "Escape") {
			// Swallowed so the dialog stays open; a second Escape closes it.
			event.stopPropagation();
			completion.set(null);
		}
	};

	const syncScroll = () => {
		const element = editorElement();
		const overlay = document.getElementById(TEMPLATE_OVERLAY_ID);
		if (element === null || overlay === null) return;
		overlay.scrollTop = element.scrollTop;
		overlay.scrollLeft = element.scrollLeft;
	};

	return Div(
		{ class: "flex flex-col gap-1.5" },
		Div(
			{ class: "relative rounded-md dark:bg-input/30" },
			Div(
				{
					id: TEMPLATE_OVERLAY_ID,
					"aria-hidden": "true",
					class:
						"pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 font-mono text-[12px] break-words whitespace-pre-wrap text-foreground/90",
				},
				ForEach(
					segments,
					(segment) => segment.key,
					(segment) =>
						Span(
							{ class: segment.bind((value) => segmentClass(value.kind)) },
							segment.bind("text"),
						),
				),
				// Keeps a trailing empty line the same height the textarea gives it.
				Span({}, "​"),
			),
			Textarea({
				id: TEMPLATE_EDITOR_ID,
				value: template,
				spellcheck: false,
				autocapitalize: "off",
				"aria-label": "Body template",
				placeholder: '{\n\t"text": "{{summary}}"\n}',
				class:
					"relative max-h-48 min-h-24 bg-transparent font-mono text-[12px] text-transparent caret-foreground md:text-[12px] dark:bg-transparent",
				onKeydown,
				onInput: refreshCompletion,
				onKeyup: refreshCompletion,
				onClick: refreshCompletion,
				onBlur: () => completion.set(null),
				onScroll: syncScroll,
			}),
			If(
				matches.bind((list) => list.length > 0),
				Div(
					{
						class:
							"absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md",
					},
					ForEach(
						matches,
						(match) => match.path,
						(match) =>
							Div(
								{
									class: derived([menuIndex, matches, match], (index, list, entry) =>
										cn(
											"flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5",
											list[index]?.path === entry.path && "bg-secondary",
										),
									),
									// preventDefault keeps focus (and the completion state) in
									// the textarea so the click can land on `accept`.
									onMousedown: (event) => event.preventDefault(),
									onClick: () => accept(match.get().path),
								},
								Span({ class: "shrink-0 font-mono text-[12px]" }, match.bind("path")),
								Span(
									{ class: "min-w-0 truncate text-[11px] text-muted-foreground" },
									match.bind("hint"),
								),
							),
					),
				),
			),
		),
		P(
			{ class: "text-[11px] text-muted-foreground" },
			"Type {{ to list every path the event carries — {{summary}}, {{event}}, " +
				"{{data.issue.identifier}}, and the rest. {{…}} escapes for use inside strings; " +
				"{{{…}}} inserts raw JSON, e.g. {{{data.issue}}}. Unknown paths are underlined.",
		),
		Div(
			{ class: "flex flex-col gap-1 rounded-md border border-border bg-secondary/30 px-3 py-2" },
			Span(
				{ class: "text-[11px] font-medium text-muted-foreground" },
				"Preview, against a sample issue.created event",
			),
			Span(
				{
					class: preview.bind((value) =>
						cn(
							"font-mono text-[11px] break-all whitespace-pre-wrap",
							value.ok ? "text-foreground/80" : "text-destructive",
						),
					),
				},
				preview.bind((value) => value.text),
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

// ---------------------------------------------------------------------------
// The Deliveries tab
// ---------------------------------------------------------------------------

interface DeliveryActions {
	toggleDetail: (deliveryId: string) => void;
	retry: (deliveryId: string) => void;
	copy: (value: string) => Promise<void>;
}

function DeliveryList(
	deliveries: Readable<WebhookDelivery[]>,
	loaded: Readable<boolean>,
	openDelivery: Readable<string>,
	detail: Readable<WebhookDeliveryDetail | null>,
	hook: Readable<Webhook | null>,
	actions: DeliveryActions,
) {
	return Div(
		{ class: "flex flex-col" },
		If(
			loaded.bind((ready) => !ready),
			P({ class: "px-4 py-3 text-[12px] text-muted-foreground" }, "Loading…"),
		),
		If(
			derived([loaded, deliveries], (ready, list) => ready && list.length === 0),
			Empty(
				{ class: "p-8 md:p-8" },
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
			(delivery) => DeliveryRow(delivery, openDelivery, detail, hook, actions),
		),
	);
}

function DeliveryRow(
	delivery: Readable<WebhookDelivery>,
	openDelivery: Readable<string>,
	detail: Readable<WebhookDeliveryDetail | null>,
	hook: Readable<Webhook | null>,
	actions: DeliveryActions,
) {
	const expanded = derived([openDelivery], (open) => open !== "" && open === delivery.get().id);

	return Div(
		{ class: "border-b border-border" },
		Div(
			{
				class:
					"flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[12px] select-none hover:bg-secondary/40",
				title: "View this delivery",
				onClick: () => actions.toggleDetail(delivery.get().id),
			},
			StatusBadge(delivery),
			Span(
				{ class: "shrink-0 font-medium" },
				delivery.bind((value) => (value.durationMs === null ? "" : `${value.durationMs}ms`)),
			),
			Span(
				{ class: "shrink-0 font-mono text-[11px] text-muted-foreground" },
				delivery.bind("event"),
			),
			Span(
				{ class: "min-w-0 flex-1 truncate text-[11px] text-muted-foreground" },
				delivery.bind((value) => value.error ?? ""),
			),
			Span(
				{ class: "shrink-0 text-[11px] text-muted-foreground" },
				delivery.bind((value) => relativeTime(value.createdAt)),
			),
			// Anything that has failed at least once can be sent again — same id,
			// same signed payload — so a fixed endpoint can catch up on what it
			// missed. On a still-pending row this brings the scheduled retry
			// forward instead of waiting out the backoff.
			If(
				delivery.bind(
					(value) =>
						value.status === "failed" || (value.status === "pending" && value.attempts > 0),
				),
				Button(
					{
						size: "icon-sm",
						variant: "ghost",
						title: "Retry this delivery",
						class: "shrink-0",
						onClick: (event) => {
							event.stopPropagation();
							actions.retry(delivery.get().id);
						},
					},
					RotateCw({ class: "size-3.5" }),
				),
			),
			ChevronDown({
				class: expanded.bind((open) =>
					cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180"),
				),
			}),
		),

		If(expanded, DeliveryDetail(delivery, detail, hook, actions)),
	);
}

/** Enough reason phrases to make a status read like the mockup's badges. */
const REASON_PHRASES: Record<number, string> = {
	200: "OK",
	201: "CREATED",
	202: "ACCEPTED",
	204: "NO CONTENT",
	301: "MOVED",
	302: "FOUND",
	304: "NOT MODIFIED",
	400: "BAD REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT FOUND",
	405: "NOT ALLOWED",
	408: "TIMEOUT",
	409: "CONFLICT",
	410: "GONE",
	413: "TOO LARGE",
	422: "UNPROCESSABLE",
	429: "TOO MANY REQUESTS",
	500: "SERVER ERROR",
	502: "BAD GATEWAY",
	503: "UNAVAILABLE",
	504: "GATEWAY TIMEOUT",
};

/** `200 OK` in green, `400 BAD REQUEST` in orange, and words when there is no status. */
function StatusBadge(delivery: Readable<WebhookDelivery>) {
	const text = delivery.bind((value) => {
		if (value.responseStatus !== null) {
			const phrase = REASON_PHRASES[value.responseStatus];
			return phrase === undefined ? `${value.responseStatus}` : `${value.responseStatus} ${phrase}`;
		}
		return value.status === "pending" ? "PENDING" : "NO RESPONSE";
	});

	return Span(
		{
			class: delivery.bind((value) =>
				cn(
					"inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium",
					value.responseStatus !== null && value.responseStatus < 300
						? "border-green-500/50 text-green-500"
						: value.responseStatus !== null
							? "border-orange-500/50 text-orange-500"
							: value.status === "pending"
								? "border-border text-muted-foreground"
								: "border-destructive/50 text-destructive",
				),
			),
		},
		text,
	);
}

/** `{"error": ...}` back into something a person scans, or the raw text as-is. */
function prettyJson(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

/** A value single-quoted for a POSIX shell, however hostile its contents. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * The delivery as a curl command — same URL, same headers, signature included,
 * same body — so "does my endpoint accept this?" can be answered from a
 * terminal instead of by clicking retry and waiting.
 */
function toCurl(url: string, detail: WebhookDeliveryDetail): string {
	const lines = [`curl -X POST ${shellQuote(url)}`];
	for (const [name, value] of Object.entries(detail.requestHeaders)) {
		lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
	}
	lines.push(`  --data-raw ${shellQuote(detail.payload)}`);
	return lines.join(" \\\n");
}

const codeBlockClass =
	"h-full max-h-64 min-h-24 overflow-auto rounded-md border border-border bg-background/80 p-2.5 pr-8 font-mono text-[11px] whitespace-pre-wrap break-all";

/** A code panel with its copy button riding the top-right corner. */
function CodePanel(text: Readable<string>, copyTitle: string, onCopy: () => void) {
	return Div(
		{ class: "relative min-w-0" },
		Button(
			{
				size: "icon-sm",
				variant: "ghost",
				title: copyTitle,
				class: "absolute top-1 right-1 z-10",
				onClick: onCopy,
			},
			Copy({ class: "size-3" }),
		),
		Div({ class: codeBlockClass }, text),
	);
}

/**
 * Everything known about one delivery: the payload that was signed and sent on
 * the left, what the endpoint said back on the right — the difference between
 * seeing "endpoint responded 400" and knowing why.
 */
function DeliveryDetail(
	delivery: Readable<WebhookDelivery>,
	detail: Readable<WebhookDeliveryDetail | null>,
	hook: Readable<Webhook | null>,
	actions: DeliveryActions,
) {
	const copyCurl = () => {
		const value = detail.get();
		const target = hook.get();
		if (value === null || target === null) return;
		void actions.copy(toCurl(target.url, value));
	};

	const copyPayload = () => {
		const value = detail.get();
		if (value !== null) void actions.copy(value.payload);
	};

	const copyResponse = () => {
		const value = detail.get();
		if (value !== null && value.responseBody !== null) void actions.copy(value.responseBody);
	};

	return Div(
		{ class: "flex flex-col gap-2.5 border-t border-border/60 bg-secondary/20 px-4 py-3" },
		If(
			detail.bind((value) => value === null),
			P({ class: "text-[11px] text-muted-foreground" }, "Loading…"),
		),
		If(
			detail.bind((value) => value !== null),
			Div(
				{ class: "flex flex-col gap-2.5" },
				Div(
					{ class: "flex items-center justify-between gap-2" },
					Span({ class: "text-[12px] font-medium" }, "Request"),
					Button(
						{
							size: "xs",
							variant: "ghost",
							class: "gap-1.5 text-[11px]",
							title: "Copy this delivery as a curl command",
							onClick: copyCurl,
						},
						SquareTerminal({ class: "size-3.5" }),
						"Copy as cURL",
					),
				),

				Div(
					{ class: "grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" },
					CodePanel(
						detail.bind((value) => (value === null ? "" : prettyJson(value.payload))),
						"Copy request payload",
						copyPayload,
					),
					Div(
						{ class: "hidden items-center md:flex" },
						ArrowRight({ class: "size-4 text-muted-foreground" }),
					),
					Div(
						{ class: "relative min-w-0" },
						If(
							detail.bind((value) => value !== null && value.responseBody !== null),
							CodePanel(
								detail.bind((value) =>
									value === null || value.responseBody === null
										? ""
										: prettyJson(value.responseBody),
								),
								"Copy response body",
								copyResponse,
							),
						),
						If(
							detail.bind((value) => value !== null && value.responseBody === null),
							Div(
								{ class: cn(codeBlockClass, "flex items-center text-muted-foreground") },
								"No response body captured — the endpoint sent nothing back, was never reached, or this delivery predates response capture.",
							),
						),
					),
				),

				Div(
					{
						class: "flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground",
					},
					Span(
						{},
						delivery.bind((value) => `${value.attempts} attempt${value.attempts === 1 ? "" : "s"}`),
					),
					Span(
						{},
						delivery.bind((value) => `queued ${fullTime(value.createdAt)}`),
					),
					Span(
						{},
						delivery.bind((value) =>
							value.deliveredAt !== null
								? `delivered ${fullTime(value.deliveredAt)}`
								: value.nextAttemptAt !== null
									? `retries ${fullTime(value.nextAttemptAt)}`
									: "",
						),
					),
					Span(
						{ class: "text-destructive" },
						delivery.bind((value) => value.error ?? ""),
					),
				),
			),
		),
	);
}
