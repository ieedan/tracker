// The screen where a person decides whether an agent may act in a workspace.
//
// Everything on it except the workspace picker is attacker-controlled: client
// registration is open, so the name, icon and link all come from whoever
// registered the client. It is rendered as untrusted text, the link is never
// followed, and the "unverified" notice is not conditional on anything a
// registration can set.
import { A, Div, H1, If, Input, P, Span, signal, type Readable } from "@implementjs/core";
import { TriangleAlert } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { HarnessLogo } from "@/lib/components/harness-logo";
import {
	AGENT_HARNESSES,
	describeScopes,
	harnessLabel,
	type HarnessKind,
} from "@/lib/domain/agents";
import { cn } from "@/lib/utils";

interface AgentRequest {
	clientId: string;
	name: string;
	icon: string | null;
	uri: string | null;
	trusted: boolean;
	scopes: string[];
	guessedHarness: HarnessKind;
}

interface PageData {
	userCode: string;
	request: AgentRequest | null;
	workspaces: { slug: string; name: string }[];
}

export function DevicePage({ data }: { data: Readable<PageData> }) {
	const current = data.get();

	return Div(
		{ class: "flex min-h-dvh items-center justify-center px-4 py-10" },
		Div(
			{ class: "w-full max-w-md" },
			current.request === null
				? CodeEntry(current)
				: Consent(current.request, current.userCode, current.workspaces),
		),
	);
}

/** Where someone lands when they open `/device` and type the code by hand. */
function CodeEntry(current: PageData) {
	const code = signal(current.userCode);

	const submit = () => {
		const value = code.get().trim().toUpperCase();
		if (value === "") return;
		window.location.assign(`/device?user_code=${encodeURIComponent(value)}`);
	};

	return Div(
		{ class: "text-center" },
		H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "Connect a device"),
		P(
			{ class: "mb-6 text-sm text-muted-foreground" },
			current.userCode === ""
				? "Enter the code shown by the application you are connecting."
				: "That code has expired or was already used. Check the application for a new one.",
		),
		Div(
			{ class: "flex flex-col gap-2" },
			Input({
				value: code,
				placeholder: "XXXXXXXX",
				autofocus: true,
				autocomplete: "off",
				spellcheck: false,
				"aria-label": "Device code",
				class:
					"h-10 w-full rounded-md border border-input bg-background px-3 text-center font-mono text-[15px] tracking-[0.3em] uppercase outline-none focus:border-ring",
				onKeydown: (event: KeyboardEvent) => {
					if (event.key === "Enter") submit();
				},
			}),
			Button({ class: "w-full", onClick: submit }, "Continue"),
		),
	);
}

function Consent(request: AgentRequest, userCode: string, workspaces: PageData["workspaces"]) {
	const slug = signal(workspaces[0]?.slug ?? "");
	const busy = signal(false);
	const scopes = describeScopes(request.scopes);

	// What this agent will be called and badged as. Seeded from a guess at the
	// client's name, but this is the person's assertion, not the client's — a
	// harness that registers as "Coding Agent" still ends up correctly labelled.
	const harness = signal<HarnessKind>(request.guessedHarness);
	const name = signal(harnessLabel(request.guessedHarness));
	// Once someone edits the name, changing the harness stops overwriting it.
	let nameEdited = false;

	const pickHarness = (kind: HarnessKind) => {
		harness.set(kind);
		if (!nameEdited) name.set(harnessLabel(kind));
	};

	const approve = async () => {
		const target = slug.get();
		if (target === "") return;

		busy.set(true);
		const { error } = await api.POST("/api/v1/device/approve", {
			body: {
				userCode,
				slug: target,
				scopes: request.scopes,
				harness: harness.get(),
				name: name.get().trim(),
			},
		});
		busy.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not authorize this application"));
			return;
		}
		window.location.assign(`/app/${target}/settings`);
	};

	const deny = async () => {
		busy.set(true);
		await api.POST("/api/v1/device/deny", { body: { userCode } });
		busy.set(false);
		window.location.assign("/app");
	};

	if (workspaces.length === 0) {
		return Div(
			{ class: "text-center" },
			H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "No workspace yet"),
			P(
				{ class: "mb-6 text-sm text-muted-foreground" },
				"An agent joins a workspace, so you need one before you can connect this application.",
			),
			A({ class: "text-sm underline underline-offset-4", href: "/workspaces/new" }, "Create one"),
		);
	}

	return Div(
		{ class: "flex flex-col gap-5" },

		Div(
			{ class: "text-center" },
			H1(
				{ class: "mb-1 text-xl font-semibold tracking-tight" },
				// Untrusted: the client chose this at registration.
				`Authorize ${request.name}`,
			),
			P(
				{ class: "text-sm text-muted-foreground" },
				"It will join the workspace as its own member, and its activity will be shown under its own name.",
			),
		),

		// Not conditional on anything the client controls. Registration is open,
		// so any name here — including one that looks official — is unverified.
		If(
			!request.trusted,
			Div(
				{
					class:
						"flex gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px]",
				},
				TriangleAlert({ class: "mt-px size-4 shrink-0 text-amber-600", "aria-hidden": true }),
				Div(
					{ class: "min-w-0" },
					Div({ class: "font-medium" }, "Unverified application"),
					P(
						{ class: "text-muted-foreground" },
						"Anyone can register an application under any name. Only continue if you started this yourself.",
					),
					request.uri === null
						? null
						: // Shown as text, never as a link: a consent screen should not be
							// a place someone can be sent somewhere by an unverified client.
							Div(
								{ class: "mt-1 truncate font-mono text-[11px] text-muted-foreground" },
								request.uri,
							),
				),
			),
		),

		// The person says what this is. A client registering as "Coding Agent"
		// would otherwise leave a bot by that name on every comment it writes.
		Div(
			{ class: "flex flex-col gap-1.5" },
			Span({ class: "text-[13px] font-medium" }, "This agent is"),
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
							onClick: () => pickHarness(kind),
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
				onInput: () => {
					nameEdited = true;
				},
			}),
			P(
				{ class: "text-[11px] text-muted-foreground" },
				"This is the name and mark its comments and issues will carry.",
			),
		),

		Div(
			{ class: "flex flex-col gap-1.5" },
			Span({ class: "text-[13px] font-medium" }, "Workspace"),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				...workspaces.map((option) =>
					Button(
						{
							variant: "ghost",
							type: "button",
							class: slug.bind((current) =>
								cn(
									"h-auto justify-start rounded-none px-3 py-2.5 text-[13px] font-normal",
									current === option.slug ? "bg-secondary" : "",
								),
							),
							onClick: () => slug.set(option.slug),
						},
						Span({ class: "flex-1 truncate text-left" }, option.name),
						Span(
							{
								class: slug.bind((current) =>
									cn("text-[11px]", current === option.slug ? "" : "invisible"),
								),
							},
							"Selected",
						),
					),
				),
			),
		),

		Div(
			{ class: "flex flex-col gap-1.5" },
			Span({ class: "text-[13px] font-medium" }, "It will be able to"),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				...scopes.map((entry) =>
					Div(
						{ class: "px-3 py-2" },
						Div({ class: "text-[13px]" }, entry.label),
						Div({ class: "text-[11px] text-muted-foreground" }, entry.hint),
					),
				),
			),
			P(
				{ class: "text-[11px] text-muted-foreground" },
				"It can never do more than you can, it is never an administrator, and it stops working if you leave the workspace.",
			),
		),

		Div(
			{ class: "flex gap-2" },
			Button({ class: "flex-1", loading: busy, onClick: () => void approve() }, "Authorize"),
			Button({ class: "flex-1", variant: "secondary", onClick: () => void deny() }, "Cancel"),
		),
	);
}

export type { AgentRequest, PageData };
