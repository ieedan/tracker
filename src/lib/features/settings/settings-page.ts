import {
	Div,
	ForEach,
	H1,
	H2,
	If,
	ImplementLifecycle,
	Input,
	P,
	Span,
	signal,
	type Child,
	type Readable,
} from "@implementjs/core";
import { Copy, Plus, Trash2 } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { UserAvatar } from "@/lib/components/glyphs";
import { Button } from "@/lib/components/ui/button";
import type { ApiKey, Label, Member, Workspace } from "@/lib/domain/schemas";
import { LABEL_COLORS } from "@/lib/domain/issues";
import { relativeTime } from "@/lib/format";
import { WebhooksSection } from "./webhooks-section";

interface PageData {
	workspace: Workspace;
	members: Member[];
	labels: Label[];
}

export function SettingsPage({
	data,
	params,
}: {
	data: Readable<PageData>;
	params: { slug: Readable<string> };
}) {
	return Div(
		{ class: "flex min-h-0 flex-1 flex-col" },
		Div(
			{ class: "flex h-12 shrink-0 items-center border-b border-border px-4" },
			H1({ class: "text-[15px] font-semibold tracking-tight" }, "Settings"),
		),
		Div(
			{ class: "min-h-0 flex-1 overflow-y-auto px-6 py-6" },
			Div(
				{ class: "mx-auto flex max-w-2xl flex-col gap-10" },
				MembersSection(data, params),
				LabelsSection(data, params),
				WebhooksSectionBlock(params),
				ApiKeysSection(),
			),
		),
	);
}

function Section(title: string, description: string, ...children: Child[]) {
	return Div(
		{ class: "flex flex-col gap-3" },
		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, title),
			P({ class: "text-[12px] text-muted-foreground" }, description),
		),
		...children,
	);
}

function MembersSection(data: Readable<PageData>, params: { slug: Readable<string> }) {
	const members = signal(data.get().members);
	data.onChange((next) => members.set(next.members));

	const email = signal("");
	const adding = signal(false);
	const inviteUrl = signal("");

	const addByEmail = async () => {
		const address = email.get().trim();
		if (address === "") return;

		adding.set(true);
		const { data: member, error } = await api.POST("/api/v1/workspaces/[slug]/members", {
			params: { slug: params.slug.get() },
			body: { email: address },
		});
		adding.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not add them"));
			return;
		}
		members.push(member);
		email.set("");
		toastSuccess(`${member.user.name} joined the workspace`);
	};

	const createInvite = async () => {
		const { data: invite, error } = await api.POST("/api/v1/workspaces/[slug]/invites", {
			params: { slug: params.slug.get() },
			body: {},
		});
		if (error !== undefined) {
			toastError(messageOf(error, "Could not create an invite link"));
			return;
		}
		inviteUrl.set(invite.url);
		await copy(invite.url);
	};

	return Section(
		"Members",
		"Add someone who already has an account, or share a link.",

		Div(
			{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
			ForEach(
				members,
				(member) => member.id,
				(member) =>
					Div(
						{ class: "flex items-center gap-3 px-3 py-2.5" },
						UserAvatar(member.get().user),
						Div(
							{ class: "min-w-0 flex-1" },
							Div(
								{ class: "truncate text-[13px]" },
								member.bind((value) => value.user.name),
							),
							Div(
								{ class: "truncate text-[12px] text-muted-foreground" },
								member.bind((value) => value.user.email),
							),
						),
						Span(
							{ class: "rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground" },
							member.bind("role"),
						),
					),
			),
		),

		Div(
			{ class: "flex gap-2" },
			Input({
				value: email,
				type: "email",
				placeholder: "teammate@example.com",
				class:
					"h-8 flex-1 rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring",
				onKeydown: (event) => {
					if (event.key === "Enter") void addByEmail();
				},
			}),
			Button({ size: "sm", loading: adding, onClick: () => void addByEmail() }, "Add"),
			Button(
				{ size: "sm", variant: "secondary", onClick: () => void createInvite() },
				"Invite link",
			),
		),

		If(
			inviteUrl.bind((value) => value !== ""),
			Div(
				{
					class:
						"flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2",
				},
				Span({ class: "min-w-0 flex-1 truncate font-mono text-[11px]" }, inviteUrl),
				Button(
					{
						size: "icon-sm",
						variant: "ghost",
						title: "Copy link",
						onClick: () => void copy(inviteUrl.get()),
					},
					Copy({ class: "size-3.5" }),
				),
			),
		),
	);
}

function LabelsSection(data: Readable<PageData>, params: { slug: Readable<string> }) {
	const labels = signal(data.get().labels);
	data.onChange((next) => labels.set(next.labels));

	const name = signal("");
	const color = signal<string>(LABEL_COLORS[0]);
	const creating = signal(false);

	const create = async () => {
		const trimmed = name.get().trim();
		if (trimmed === "") return;

		creating.set(true);
		const { data: label, error } = await api.POST("/api/v1/workspaces/[slug]/labels", {
			params: { slug: params.slug.get() },
			body: { name: trimmed, color: color.get() },
		});
		creating.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the label"));
			return;
		}
		labels.push(label);
		name.set("");
	};

	return Section(
		"Labels",
		"Labels are shared across every issue in this workspace.",

		Div(
			{ class: "flex flex-wrap gap-1.5" },
			ForEach(
				labels,
				(label) => label.id,
				(label) =>
					Span(
						{
							class:
								"inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px]",
						},
						Span({
							class: "size-2 rounded-full",
							style: { backgroundColor: label.get().color },
						}),
						label.bind("name"),
					),
			),
		),

		Div(
			{ class: "flex gap-2" },
			Div(
				{ class: "flex items-center gap-1" },
				...LABEL_COLORS.map((swatch) =>
					Div({
						class: color.bind((current) =>
							current === swatch
								? "size-5 cursor-pointer rounded-full ring-2 ring-ring ring-offset-2 ring-offset-background"
								: "size-5 cursor-pointer rounded-full",
						),
						style: { backgroundColor: swatch },
						title: swatch,
						onClick: () => color.set(swatch),
					}),
				),
			),
			Input({
				value: name,
				placeholder: "Label name",
				class:
					"h-8 flex-1 rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring",
				onKeydown: (event) => {
					if (event.key === "Enter") void create();
				},
			}),
			Button({ size: "sm", loading: creating, onClick: () => void create() }, "Add label"),
		),
	);
}

/**
 * API keys belong to the person, not the workspace, but this is where someone
 * goes looking for them. Fetched in the browser so a freshly minted key's
 * plaintext never lands in a server-rendered payload.
 */
function ApiKeysSection() {
	const keys = signal<ApiKey[]>([]);
	const name = signal("");
	const creating = signal(false);
	const plaintext = signal("");

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/api-keys");
		if (error === undefined) keys.set(data);
	};

	const create = async () => {
		const trimmed = name.get().trim();
		if (trimmed === "") return;

		creating.set(true);
		const { data, error } = await api.POST("/api/v1/api-keys", { body: { name: trimmed } });
		creating.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not create the key"));
			return;
		}
		keys.push(data.key);
		plaintext.set(data.plaintext);
		name.set("");
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

	return Section(
		"API keys",
		"Authenticate the REST API with an Authorization: Bearer header.",

		ImplementLifecycle({ onMount: () => void load() }),

		If(
			plaintext.bind((value) => value !== ""),
			Div(
				{ class: "rounded-md border border-primary/40 bg-primary/5 p-3" },
				P(
					{ class: "mb-2 text-[12px] font-medium" },
					"Copy this now — it is stored hashed and cannot be shown again.",
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
									{ class: "font-mono text-[11px] text-muted-foreground" },
									key.bind((value) => `${value.start ?? value.prefix ?? "trk_"}…`),
								),
							),
							Span(
								{ class: "text-[11px] text-muted-foreground" },
								key.bind((value) =>
									value.lastRequest === null
										? "never used"
										: `used ${relativeTime(value.lastRequest)}`,
								),
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

		Div(
			{ class: "flex gap-2" },
			Input({
				value: name,
				placeholder: "Key name (e.g. CI)",
				class:
					"h-8 flex-1 rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring",
				onKeydown: (event) => {
					if (event.key === "Enter") void create();
				},
			}),
			Button(
				{ size: "sm", loading: creating, class: "gap-1.5", onClick: () => void create() },
				Plus({ class: "size-3.5" }),
				"Create key",
			),
		),
	);
}

/** Only admins can manage webhooks, so the section is theirs alone. */
function WebhooksSectionBlock(params: { slug: Readable<string> }) {
	return Section(
		"Webhooks",
		"Get a signed POST whenever something happens in this workspace.",
		WebhooksSection(params.slug, copy),
	);
}

async function copy(value: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value);
		toastSuccess("Copied to clipboard");
	} catch {
		toastError("Could not copy — select and copy manually");
	}
}
