// Agents authorized into this workspace. Unlike API keys, these belong to the
// workspace rather than to a person, so this list is shared: everyone sees the
// same agents, and an admin can revoke one someone else set up.
import {
	Div,
	ForEach,
	H2,
	If,
	ImplementEffect,
	ImplementLifecycle,
	Input,
	P,
	Pre,
	Span,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Bot, Check, Copy, Pencil, Plus, Trash2 } from "@implementjs/lucide";
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { HarnessLogo } from "@/lib/components/harness-logo";
import {
	AGENT_HARNESSES,
	agentDisplayName,
	describeScopes,
	harnessLabel,
	type HarnessKind,
} from "@/lib/domain/agents";
import type { InstalledAgent } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AgentsSection(slug: Readable<string>, copy: (value: string) => Promise<void>) {
	const agents = signal<InstalledAgent[]>([]);
	const editing = signal<InstalledAgent | null>(null);
	const connecting = signal(false);

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/agents", {
			params: { slug: slug.get() },
		});
		if (error === undefined) agents.set(data);
	};

	const revoke = async (grantId: string) => {
		const before = agents.get();
		agents.set(before.filter((agent) => agent.grantId !== grantId));

		const { error } = await api.DELETE("/api/v1/workspaces/[slug]/agents/[grantId]", {
			params: { slug: slug.get(), grantId },
		});
		if (error !== undefined) {
			agents.set(before);
			toastError(messageOf(error, "Could not revoke this agent"));
		}
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		ImplementLifecycle({ onMount: () => void load() }),

		Div(
			{ class: "flex items-start justify-between gap-3" },
			Div(
				{},
				H2({ class: "text-[14px] font-semibold" }, "Agents"),
				P(
					{ class: "text-[12px] text-muted-foreground" },
					"Applications authorized to act in this workspace. Each one is a member in its own right, so its comments and issues appear under its own name.",
				),
			),
			Button(
				{ size: "sm", class: "gap-1.5", onClick: () => connecting.set(true) },
				Plus({ class: "size-3.5" }),
				"Connect agent",
			),
		),

		If(
			agents.bind((list) => list.length > 0),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				ForEach(
					agents,
					(agent) => agent.grantId,
					(agent) =>
						Div(
							{ class: "flex items-start gap-3 px-3 py-2.5" },
							HarnessLogo(agent.bind("harness"), "mt-0.5 size-5"),
							Div(
								{ class: "min-w-0 flex-1" },
								Div(
									{ class: "flex items-center gap-1.5" },
									Span({ class: "truncate text-[13px]" }, agent.bind("name")),
									Span(
										{
											class:
												"rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase",
										},
										"Agent",
									),
								),
								Div(
									{ class: "truncate text-[12px] text-muted-foreground" },
									agent.bind(
										(value) =>
											`${summarize(value.scopes)} · authorized by ${value.installedBy.name}`,
									),
								),
								Div(
									{ class: "text-[11px] text-muted-foreground" },
									agent.bind((value) =>
										value.lastUsedAt === null
											? "Never used"
											: `Last used ${relativeTime(value.lastUsedAt)}`,
									),
								),
							),
							Button({
								size: "icon-sm",
								variant: "ghost",
								"aria-label": "Rename",
								onClick: () => editing.set(agent.get()),
								children: Pencil({ class: "size-3.5", "aria-hidden": true }),
							}),
							Button({
								size: "icon-sm",
								variant: "ghost",
								"aria-label": "Revoke",
								onClick: () => void revoke(agent.get().grantId),
								children: Trash2({ class: "size-3.5", "aria-hidden": true }),
							}),
						),
				),
			),
		),

		If(
			agents.bind((list) => list.length === 0),
			Empty(
				{ class: "border md:p-8" },
				EmptyHeader(
					EmptyMedia({ variant: "icon" }, Bot({ "aria-hidden": true })),
					EmptyTitle("No agents yet"),
					EmptyDescription("Connect one, then approve the code it shows you."),
				),
			),
		),

		ConnectDialog(connecting, copy),
		RenameDialog(editing, slug, (updated) => {
			agents.update((list) =>
				list.map((row) =>
					row.agentId === updated.agentId
						? { ...row, name: updated.name, harness: updated.harness }
						: row,
				),
			);
		}),
	);
}

/** "Read and write issues, read workspace" — what the grant actually allows. */
function summarize(scopes: string[]): string {
	const described = describeScopes(scopes);
	if (described.length === 0) return "No access";
	return described.map((entry) => entry.label).join(", ");
}

/**
 * Fixes a name or the harness behind it.
 *
 * A bot is one identity per workspace, so this is a workspace-wide change —
 * whoever set the agent up first named it, and this is how anyone else corrects
 * that without having to revoke and re-authorize.
 */
function RenameDialog(
	editing: Signal<InstalledAgent | null>,
	slug: Readable<string>,
	onSaved: (agent: InstalledAgent) => void,
) {
	const name = signal("");
	const harness = signal<HarnessKind>("other");
	const saving = signal(false);

	// `Dialog` drives a two-way `open`, while the row that was clicked lives in
	// `editing`. Mirror one onto the other, guarding both writes so closing the
	// dialog and clearing the row do not bounce off each other.
	const open = signal(editing.get() !== null);
	editing.onChange((current) => {
		const next = current !== null;
		if (open.get() !== next) open.set(next);
	});
	open.onChange((isOpen) => {
		if (!isOpen && editing.get() !== null) editing.set(null);
	});

	// Seed the fields whenever a different row opens the dialog.
	let seeded: string | null = null;
	const seed = (agent: InstalledAgent | null) => {
		if (agent === null || agent.agentId === seeded) return;
		seeded = agent.agentId;
		name.set(agent.name);
		harness.set(agent.harness);
	};

	const save = async () => {
		const agent = editing.get();
		if (agent === null) return;

		saving.set(true);
		const body = { name: name.get().trim(), harness: harness.get() };
		const { error } = await api.PATCH("/api/v1/workspaces/[slug]/agents/[grantId]", {
			params: { slug: slug.get(), grantId: agent.grantId },
			body,
		});
		saving.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not rename this agent"));
			return;
		}

		// An empty name falls back to the harness label, exactly as the server does.
		onSaved({ ...agent, name: agentDisplayName(body.harness, body.name), harness: body.harness });
		editing.set(null);
	};

	return Dialog(
		{
			open,
			onOpenChange: (value) => {
				if (!value) editing.set(null);
			},
		},
		ImplementEffect([editing], (current) => seed(current)),
		DialogContent(
			{ class: "max-w-sm gap-0 p-0" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle({ class: "text-[15px] font-semibold" }, "Rename agent"),
				DialogDescription(
					{ class: "text-[12px]" },
					"Everyone in this workspace sees this name, including on comments it has already written.",
				),
			),
			Div(
				{ class: "flex flex-col gap-4 px-4 py-4" },
				Div(
					{ class: "grid grid-cols-3 gap-1.5" },
					...AGENT_HARNESSES.map((kind) =>
						Button(
							{
								variant: "ghost",
								type: "button",
								class: harness.bind((current) =>
									cn(
										"h-auto flex-col gap-1.5 rounded-md border px-2 py-2.5 text-[11px] font-normal",
										current === kind
											? "border-primary bg-primary/10 text-foreground"
											: "border-border text-muted-foreground",
									),
								),
								onClick: () => harness.set(kind),
							},
							HarnessLogo(kind, "size-5"),
							Span({ class: "truncate" }, harnessLabel(kind)),
						),
					),
				),
				Input({
					value: name,
					placeholder: "Name in this workspace",
					"aria-label": "Agent name",
					maxLength: 60,
					class:
						"h-8 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring",
					onKeydown: (event) => {
						if (event.key === "Enter") void save();
					},
				}),
			),
			Div(
				{ class: "flex justify-end gap-2 border-t border-border px-4 py-2.5" },
				Button({ variant: "ghost", size: "sm", onClick: () => editing.set(null) }, "Cancel"),
				Button({ size: "sm", loading: saving, onClick: () => void save() }, "Save"),
			),
		),
	);
}

/**
 * The setup prompt.
 *
 * Written to be pasted straight into a coding agent: every call here is one the
 * agent makes itself, so the person's only job is to approve the code it shows
 * them. The endpoints and the shape of each request are the ones this app
 * actually serves — see `auth.server.ts` for where they come from.
 *
 * Two details that look like mistakes and are not: registration requires at
 * least one redirect URI even for a flow that never redirects, and it must be a
 * loopback literal (`localhost` is rejected for a web client); and the device
 * code is redeemed at `/oauth2/token`, not `/device/token`, because the OAuth
 * provider owns the grant.
 */
function setupPrompt(origin: string): string {
	return `Connect to my issue tracker at ${origin}. It speaks OAuth 2.1 device
authorization, so you will end up with your own identity rather than borrowing mine.

1. Register yourself as a client:
   POST ${origin}/api/auth/oauth2/register
   {"client_name": "<what you are, e.g. Claude Code>",
    "application_type": "native",
    "grant_types": ["urn:ietf:params:oauth:grant-type:device_code"],
    "token_endpoint_auth_method": "none",
    "redirect_uris": ["http://127.0.0.1:9999/callback"]}
   Keep the client_id. Register once and reuse it.

2. Start the device flow:
   POST ${origin}/api/auth/device/code
   {"client_id": "<client_id>", "scope": "issues:read issues:write"}

3. Show me verification_uri_complete and user_code, and wait. I have to approve
   it in a browser and choose which workspace you may act in.

4. Poll every "interval" seconds until you get an access_token:
   POST ${origin}/api/auth/oauth2/token
   Content-Type: application/x-www-form-urlencoded
   grant_type=urn:ietf:params:oauth:grant-type:device_code
   &device_code=<device_code>&client_id=<client_id>
   "authorization_pending" means keep waiting.

5. Store the access_token somewhere private, never in the repo. Call the API with
   Authorization: Bearer <access_token>
   Base URL: ${origin}/api/v1
   Start with GET /api/v1/me to confirm who you are.
   Full reference: ${origin}/openapi.json

Notes: the token expires in an hour. Your access can never exceed mine, you are
never an administrator, and anything you write is attributed to you, not to me.`;
}

/** Numbered steps for the person, and the prompt for their agent. */
function ConnectDialog(open: Signal<boolean>, copy: (value: string) => Promise<void>) {
	const origin = signal("");
	const copied = signal(false);

	const steps: [string, string][] = [
		["Paste the prompt below into your coding agent", "It registers itself and starts the flow."],
		[
			"It shows you a link and an eight-character code",
			"Open the link; the code is already filled in.",
		],
		[
			"Choose the workspace and confirm what it is",
			"This is where you say it is Claude Code, Cursor, and so on.",
		],
		["Approve", "It picks up its token and appears in this list."],
	];

	const doCopy = async () => {
		await copy(setupPrompt(origin.get()));
		copied.set(true);
		setTimeout(() => copied.set(false), 2000);
	};

	return Dialog(
		{ open },
		// The origin is only known in the browser, and the prompt is useless
		// without it — an agent cannot guess where this app lives.
		ImplementLifecycle({ onMount: () => origin.set(window.location.origin) }),
		DialogContent(
			{ class: "max-w-lg gap-0 p-0" },
			Div(
				{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
				DialogTitle({ class: "text-[15px] font-semibold" }, "Connect an agent"),
				DialogDescription(
					{ class: "text-[12px]" },
					"Your agent authenticates as itself. You approve it once, in a browser.",
				),
			),

			Div(
				{ class: "flex flex-col gap-4 px-4 py-4" },
				Div(
					{ class: "flex flex-col gap-1.5" },
					...steps.map(([title, hint], index) =>
						Div(
							{ class: "flex gap-2.5" },
							Span(
								{
									class:
										"mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground",
								},
								String(index + 1),
							),
							Div(
								{ class: "min-w-0" },
								Div({ class: "text-[12px]" }, title),
								Div({ class: "text-[11px] text-muted-foreground" }, hint),
							),
						),
					),
				),

				Div(
					{ class: "flex flex-col gap-1.5" },
					Div(
						{ class: "flex items-center justify-between gap-2" },
						Span({ class: "text-[12px] font-medium" }, "Setup prompt"),
						Button(
							{
								size: "xs",
								variant: "secondary",
								class: "text-[11px]",
								onClick: () => void doCopy(),
							},
							If(copied, Check({ class: "size-3", "aria-hidden": true })),
							If(
								copied.bind((done) => !done),
								Copy({ class: "size-3", "aria-hidden": true }),
							),
							copied.bind((done) => (done ? "Copied" : "Copy")),
						),
					),
					Pre(
						{
							class:
								"max-h-64 overflow-auto rounded-md border border-border bg-background p-2.5 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground",
						},
						origin.bind((value) => (value === "" ? "" : setupPrompt(value))),
					),
				),
			),

			Div(
				{ class: "flex justify-end border-t border-border px-4 py-2.5" },
				Button({ size: "sm", variant: "secondary", onClick: () => open.set(false) }, "Done"),
			),
		),
	);
}
