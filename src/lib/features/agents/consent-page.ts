// The screen where a person decides whether an agent may act as them.
//
// The client's name and link are attacker-controlled — registration is open, so
// they come from whoever registered it. They are rendered as untrusted text,
// the link is never followed, and the "unverified" notice is not conditional on
// anything a registration can set.
import { A, Div, H1, If, P, Span, signal, type Readable } from "@implementjs/core";
import { TriangleAlert } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { HarnessLogo } from "@/lib/components/harness-logo";
import { Button } from "@/lib/components/ui/button";
import {
	AGENT_HARNESSES,
	describeScopes,
	harnessLabel,
	type HarnessKind,
} from "@/lib/domain/agents";
import { cn } from "@/lib/utils";

interface PageData {
	oauthQuery: string;
	client: { clientId: string; name: string; trusted: boolean; uri: string | null } | null;
	workspaces: { slug: string; name: string }[];
	scopes: string[];
	guessedHarness: HarnessKind;
}

export function ConsentPage({ data }: { data: Readable<PageData> }) {
	const current = data.get();

	return Div(
		{ class: "flex min-h-dvh items-center justify-center px-4 py-10" },
		Div(
			{ class: "w-full max-w-md" },
			current.client === null
				? Invalid()
				: current.workspaces.length === 0
					? NoWorkspace()
					: Consent(current, current.client),
		),
	);
}

function Invalid() {
	return Div(
		{ class: "text-center" },
		H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "Request not valid"),
		P(
			{ class: "text-sm text-muted-foreground" },
			"This authorization request has expired or names an application that is no longer registered. Start again from the application.",
		),
	);
}

function NoWorkspace() {
	return Div(
		{ class: "text-center" },
		H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, "No workspace yet"),
		P(
			{ class: "mb-6 text-sm text-muted-foreground" },
			"An agent acts inside your workspaces, so you need one before connecting this application.",
		),
		A({ class: "text-sm underline underline-offset-4", href: "/workspaces/new" }, "Create one"),
	);
}

function Consent(current: PageData, client: NonNullable<PageData["client"]>) {
	const busy = signal(false);
	const scopes = describeScopes(current.scopes);

	// What this agent is. Seeded from a guess at the client's name, but this is
	// the person's assertion, not the client's — a harness that registers as
	// "Coding Agent" still ends up correctly labelled.
	const harness = signal<HarnessKind>(current.guessedHarness);

	const answer = async (accept: boolean) => {
		busy.set(true);
		const { data, error } = await api.POST("/api/v1/oauth/consent", {
			body: {
				oauthQuery: current.oauthQuery,
				accept,
				scopes: current.scopes,
				harness: harness.get(),
			},
		});
		busy.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not answer this authorization request"));
			return;
		}
		// The destination is the client's own callback, so the browser has to be
		// what navigates there — the provider returns the URL rather than a 302.
		window.location.assign(data.redirect);
	};

	return Div(
		{ class: "flex flex-col gap-5" },

		Div(
			{ class: "text-center" },
			H1(
				{ class: "mb-1 text-xl font-semibold tracking-tight" },
				// Untrusted: the client chose this at registration.
				`Authorize ${client.name}`,
			),
			P(
				{ class: "text-sm text-muted-foreground" },
				"It will act as its own member of your workspaces, and its activity will be shown under its own name.",
			),
		),

		// Not conditional on anything the client controls. Registration is open,
		// so any name here — including one that looks official — is unverified.
		If(
			!client.trusted,
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
					client.uri === null
						? null
						: // Shown as text, never as a link: a consent screen should not be
							// a place someone can be sent somewhere by an unverified client.
							Div(
								{ class: "mt-1 truncate font-mono text-[11px] text-muted-foreground" },
								client.uri,
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
							class: harness.bind((currentKind) =>
								cn(
									"h-auto flex-col gap-1.5 rounded-md border px-2 py-2.5 text-[11px] font-normal",
									currentKind === kind
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
			P(
				{ class: "text-[11px] text-muted-foreground" },
				"This is the name and mark its comments and issues will carry. Every install of it, by anyone, shares that one identity.",
			),
		),

		// Listed, not chosen from. A grant is not scoped to a workspace, so this is
		// the reach being granted — and it grows if you join another later.
		Div(
			{ class: "flex flex-col gap-1.5" },
			Span({ class: "text-[13px] font-medium" }, "Where it can act"),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				...current.workspaces.map((option) =>
					Div({ class: "truncate px-3 py-2 text-[13px]" }, option.name),
				),
			),
			P(
				{ class: "text-[11px] text-muted-foreground" },
				"Every workspace you are a member of, including any you join later.",
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
				"It stays connected until you revoke it in Settings. It can never do more than you can, it is never an administrator, and it stops working if you leave the workspace.",
			),
		),

		Div(
			{ class: "flex gap-2" },
			Button({ class: "flex-1", loading: busy, onClick: () => void answer(true) }, "Authorize"),
			Button(
				{ class: "flex-1", variant: "secondary", onClick: () => void answer(false) },
				"Cancel",
			),
		),
	);
}
