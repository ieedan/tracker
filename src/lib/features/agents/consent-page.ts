// Consent for the plain authorization-code flow.
//
// Agents take the device flow instead, which has its own richer screen in
// device-page.ts — that is where a workspace is chosen and a bot member is
// created. This page exists because `oauthProvider` requires a consent page for
// the redirect-based flow, and it applies the same rule about untrusted client
// metadata: the name is rendered as text, and the "unverified" notice is not
// conditional on anything a registration can set.
import { Div, H1, If, P, Span, signal, type Readable } from "@implementjs/core";
import { TriangleAlert } from "@implementjs/lucide";
import { Button } from "@/lib/components/ui/button";
import { describeScopes } from "@/lib/domain/agents";

interface PageData {
	oauthQuery: string;
	client: { clientId: string; name: string; trusted: boolean } | null;
	scopes: string[];
}

export function ConsentPage({ data }: { data: Readable<PageData> }) {
	const current = data.get();

	return Div(
		{ class: "flex min-h-dvh items-center justify-center px-4 py-10" },
		Div(
			{ class: "w-full max-w-md" },
			current.client === null ? Invalid() : Prompt(current, current.client),
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

function Prompt(current: PageData, client: NonNullable<PageData["client"]>) {
	const busy = signal(false);
	const scopes = describeScopes(current.scopes);

	/**
	 * A real form post. The provider answers with the redirect back to the
	 * client, so the browser has to be what makes the request — a fetch would
	 * follow the redirect itself and strip the navigation.
	 */
	const answer = (accept: boolean) => {
		busy.set(true);
		const form = document.createElement("form");
		form.method = "POST";
		form.action = "/api/auth/oauth2/consent";

		const fields: Record<string, string> = {
			accept: String(accept),
			oauth_query: current.oauthQuery,
		};
		for (const [name, value] of Object.entries(fields)) {
			const field = document.createElement("input");
			field.type = "hidden";
			field.name = name;
			field.value = value;
			form.append(field);
		}

		document.body.append(form);
		form.submit();
	};

	return Div(
		{ class: "flex flex-col gap-5" },
		Div(
			{ class: "text-center" },
			// Untrusted: the client chose this at registration.
			H1({ class: "mb-1 text-xl font-semibold tracking-tight" }, `Authorize ${client.name}`),
			P({ class: "text-sm text-muted-foreground" }, "It is asking to access your account."),
		),

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
				),
			),
		),

		If(
			scopes.length > 0,
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
			),
		),

		Div(
			{ class: "flex gap-2" },
			Button({ class: "flex-1", loading: busy, onClick: () => answer(true) }, "Authorize"),
			Button({ class: "flex-1", variant: "secondary", onClick: () => answer(false) }, "Cancel"),
		),
	);
}
