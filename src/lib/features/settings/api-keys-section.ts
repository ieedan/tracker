// API keys belong to the person, not the workspace, but Settings is where
// someone goes looking for them. Fetched in the browser so a freshly minted
// key's plaintext never lands in a server-rendered payload.
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
	type Signal,
} from "@implementjs/core";
import { Copy, KeyRound, Plus, Trash2 } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
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
import {
	API_KEY_EXPIRATIONS,
	API_KEY_RESOURCE_HINTS,
	API_KEY_RESOURCE_LABELS,
	API_KEY_RESOURCES,
	summarizePermissions,
	type ApiKeyAction,
	type ApiKeyExpiration,
	type ApiKeyPermissions,
	type ApiKeyResource,
} from "@/lib/domain/api-keys";
import type { ApiKey } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const inputClass =
	"h-8 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring";

export function ApiKeysSection(copy: (value: string) => Promise<void>) {
	const keys = signal<ApiKey[]>([]);
	const open = signal(false);
	const plaintext = signal("");

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/api-keys");
		if (error === undefined) keys.set(data);
	};

	const revoke = async (id: string) => {
		const before = keys.get();
		keys.set(before.filter((key) => key.id !== id));
		const { error } = await api.DELETE("/api/v1/api-keys/[id]", { params: { id } });
		if (error !== undefined) {
			keys.set(before);
			toastError(messageOf(error, "Could not revoke the key"));
		}
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		ImplementLifecycle({ onMount: () => void load() }),

		Div(
			{ class: "flex items-start justify-between gap-3" },
			Div(
				{},
				H2({ class: "text-[14px] font-semibold" }, "API keys"),
				P(
					{ class: "text-[12px] text-muted-foreground" },
					"Authenticate the REST API with an Authorization: Bearer header.",
				),
			),
			Button(
				{ size: "sm", class: "gap-1.5", onClick: () => open.set(true) },
				Plus({ class: "size-3.5" }),
				"Create key",
			),
		),

		If(
			plaintext.bind((value) => value !== ""),
			Div(
				{ class: "rounded-md border border-primary/40 bg-primary/5 p-3" },
				P(
					{ class: "mb-2 text-[12px] font-medium" },
					"Copy this now. It is stored hashed and cannot be shown again.",
				),
				Div(
					{ class: "flex items-center gap-2" },
					Span({ class: "min-w-0 flex-1 truncate font-mono text-[11px]" }, plaintext),
					Button(
						{
							size: "icon-sm",
							variant: "ghost",
							title: "Copy key",
							onClick: () => void copy(plaintext.get()),
						},
						Copy({ class: "size-3.5" }),
					),
				),
			),
		),

		If(
			keys.bind((list) => list.length > 0),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				ForEach(
					keys,
					(key) => key.id,
					(key) =>
						Div(
							{ class: "flex items-center gap-3 px-3 py-2.5" },
							Div(
								{ class: "min-w-0 flex-1" },
								Div(
									{ class: "truncate text-[13px]" },
									key.bind((value) => value.name ?? "Key"),
								),
								Div(
									{ class: "truncate text-[11px] text-muted-foreground" },
									key.bind(
										(value) =>
											`${value.start ?? value.prefix ?? "trk_"}… · ${summarizePermissions(value.permissions)}`,
									),
								),
							),
							Span(
								{ class: "shrink-0 text-[11px] text-muted-foreground" },
								key.bind((value) => expiryStamp(value)),
							),
							Button(
								{
									size: "icon-sm",
									variant: "ghost",
									title: "Revoke",
									onClick: () => void revoke(key.get().id),
								},
								Trash2({ class: "size-3.5" }),
							),
						),
				),
			),
		),

		If(
			keys.bind((list) => list.length === 0),
			Empty(
				{ class: "border md:p-8" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, KeyRound({ "aria-hidden": true })),
					EmptyTitle("No API keys yet"),
					EmptyDescription("Create one to call the REST API from a script or CI."),
				),
			),
		),

		CreateApiKeyDialog(open, (created, secret) => {
			keys.push(created);
			plaintext.set(secret);
		}),
	);
}

function CreateApiKeyDialog(
	open: Signal<boolean>,
	onCreated: (key: ApiKey, plaintext: string) => void,
) {
	const name = signal("");
	const expiration = signal<ApiKeyExpiration>("never");
	const creating = signal(false);
	const cells = permissionCells();
	const grantedCount = signal(API_KEY_RESOURCES.length * 2);

	const recount = () => {
		grantedCount.set(
			API_KEY_RESOURCES.reduce(
				(total, resource) =>
					total + (cells[resource].read.get() ? 1 : 0) + (cells[resource].write.get() ? 1 : 0),
				0,
			),
		);
	};

	const reset = () => {
		name.set("");
		expiration.set("never");
		applyPreset(cells, "all");
		recount();
	};

	const setAction = (resource: ApiKeyResource, action: ApiKeyAction, value: boolean) => {
		if (action === "write") {
			cells[resource].write.set(value);
			if (value) cells[resource].read.set(true);
		} else {
			cells[resource].read.set(value);
			if (!value) cells[resource].write.set(false);
		}
		recount();
	};

	const submit = async () => {
		const trimmed = name.get().trim();
		if (trimmed === "" || grantedCount.get() === 0) return;

		const expiry = API_KEY_EXPIRATIONS.find((entry) => entry.value === expiration.get());
		creating.set(true);
		const { data, error } = await api.POST("/api/v1/api-keys", {
			body: {
				name: trimmed,
				permissions: collect(cells),
				expiresIn: expiry?.seconds ?? undefined,
			},
		});
		creating.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the key"));
			return;
		}

		onCreated(data.key, data.plaintext);
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
				DialogTitle({ class: "text-[15px] font-semibold" }, "Create API key"),
				DialogDescription(
					{ class: "text-[12px]" },
					"Name it, pick an expiry, and choose what it can do.",
				),
			),

			Div(
				{ class: "flex flex-col gap-4 px-4 py-4" },
				Div(
					{ class: "flex flex-col gap-1.5" },
					Label({ for: "api-key-name", class: "text-[13px]" }, "Name"),
					Input({
						id: "api-key-name",
						value: name,
						placeholder: "CI",
						autofocus: true,
						class: inputClass,
						onKeydown: (event) => {
							if (event.key === "Enter") void submit();
						},
					}),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Span({ class: "text-[13px] font-medium" }, "Expires"),
					Div(
						{ class: "flex flex-wrap gap-1.5" },
						...API_KEY_EXPIRATIONS.map((entry) =>
							Button(
								{
									size: "sm",
									variant: "ghost",
									type: "button",
									class: expiration.bind((current) =>
										cn(
											"h-6 rounded-full border px-2.5 text-[11px]",
											current === entry.value
												? "border-primary bg-primary/10 text-foreground"
												: "border-border text-muted-foreground",
										),
									),
									onClick: () => expiration.set(entry.value),
								},
								entry.label,
							),
						),
					),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Div(
						{ class: "flex items-center justify-between gap-2" },
						Span({ class: "text-[13px] font-medium" }, "Permissions"),
						Div(
							{ class: "flex gap-1" },
							Button(
								{
									size: "xs",
									variant: "ghost",
									type: "button",
									class: "text-[11px] text-muted-foreground",
									onClick: () => {
										applyPreset(cells, "read");
										recount();
									},
								},
								"Read only",
							),
							Button(
								{
									size: "xs",
									variant: "ghost",
									type: "button",
									class: "text-[11px] text-muted-foreground",
									onClick: () => {
										applyPreset(cells, "all");
										recount();
									},
								},
								"All access",
							),
						),
					),
					Div(
						{
							class: "flex flex-col divide-y divide-border rounded-md border border-border",
						},
						Div(
							{
								class:
									"grid grid-cols-[1fr_2.75rem_2.75rem] items-center gap-x-2 px-3 py-1.5 text-[11px] text-muted-foreground",
							},
							Span("Permission"),
							Span({ class: "text-center" }, "Read"),
							Span({ class: "text-center" }, "Write"),
						),
						...API_KEY_RESOURCES.map((resource) =>
							Div(
								{
									class: "grid grid-cols-[1fr_2.75rem_2.75rem] items-center gap-x-2 px-3 py-2",
								},
								Div(
									{ class: "min-w-0 pr-2" },
									Div({ class: "text-[13px]" }, API_KEY_RESOURCE_LABELS[resource]),
									Div(
										{ class: "text-[11px] text-muted-foreground" },
										API_KEY_RESOURCE_HINTS[resource],
									),
								),
								Div(
									{ class: "flex justify-center" },
									Checkbox({
										checked: cells[resource].read,
										"aria-label": `Read ${API_KEY_RESOURCE_LABELS[resource]}`,
										onCheckedChange: (value) => setAction(resource, "read", value),
									}),
								),
								Div(
									{ class: "flex justify-center" },
									Checkbox({
										checked: cells[resource].write,
										"aria-label": `Write ${API_KEY_RESOURCE_LABELS[resource]}`,
										onCheckedChange: (value) => setAction(resource, "write", value),
									}),
								),
							),
						),
					),
				),
			),

			Div(
				{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				Button(
					{
						size: "sm",
						loading: creating,
						disabled: derived(
							[name, grantedCount],
							(value, count) => value.trim() === "" || count === 0,
						),
						onClick: () => void submit(),
					},
					"Create key",
				),
			),
		),
	);
}

type PermissionCells = Record<ApiKeyResource, { read: Signal<boolean>; write: Signal<boolean> }>;

function permissionCells(): PermissionCells {
	return Object.fromEntries(
		API_KEY_RESOURCES.map((resource) => [resource, { read: signal(true), write: signal(true) }]),
	) as PermissionCells;
}

function applyPreset(cells: PermissionCells, preset: "all" | "read"): void {
	for (const resource of API_KEY_RESOURCES) {
		cells[resource].read.set(true);
		cells[resource].write.set(preset === "all");
	}
}

function collect(cells: PermissionCells): ApiKeyPermissions {
	const granted: ApiKeyPermissions = {};
	for (const resource of API_KEY_RESOURCES) {
		const actions: ApiKeyAction[] = [];
		if (cells[resource].read.get()) actions.push("read");
		if (cells[resource].write.get()) actions.push("write");
		if (actions.length > 0) granted[resource] = actions;
	}
	return granted;
}

function expiryStamp(key: ApiKey): string {
	if (key.expiresAt !== null) {
		const then = new Date(key.expiresAt).getTime();
		if (!Number.isNaN(then) && then <= Date.now()) return "expired";
		if (!Number.isNaN(then)) return `expires ${formatExpiry(key.expiresAt)}`;
	}
	if (key.lastRequest === null) return "never used";
	return `used ${relativeTime(key.lastRequest)}`;
}

function formatExpiry(iso: string): string {
	const then = new Date(iso).getTime();
	const days = Math.round((then - Date.now()) / (24 * 3600 * 1000));
	if (days <= 0) return "today";
	if (days === 1) return "tomorrow";
	if (days < 30) return `in ${days}d`;
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
