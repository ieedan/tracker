// The agents you have connected.
//
// Account-level rather than per-workspace: a grant is not scoped to a
// workspace, so one authorization reaches everywhere you are a member —
// including workspaces you join later. Revoking here cuts that install off
// everywhere at once, which is the flip side of only having to connect it once.
import {
	Div,
	ForEach,
	H2,
	If,
	ImplementLifecycle,
	P,
	Pre,
	Span,
	signal,
	type Signal,
} from "@implementjs/core";
import { Check, Copy, Plus, Trash2 } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { HarnessLogo, McpLogo } from "@/lib/components/harness-logo";
import { Button } from "@/lib/components/ui/button";
import { DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import {
	RESPONSIVE_DIALOG_PANEL,
	ResponsiveDialog,
	ResponsiveDialogBody,
	ResponsiveDialogContent,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
} from "@/lib/components/ui/responsive-dialog";
import { describeScopes } from "@/lib/domain/agents";
import type { ConnectedAgent } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AgentsSection(copy: (value: string) => Promise<void>) {
	const agents = signal<ConnectedAgent[]>([]);
	const connecting = signal(false);

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/agents");
		if (error === undefined) agents.set(data);
	};

	const revoke = async (grantId: string) => {
		const before = agents.get();
		agents.set(before.filter((agent) => agent.grantId !== grantId));

		const { error } = await api.DELETE("/api/v1/agents/[grantId]", { params: { grantId } });
		if (error !== undefined) {
			agents.set(before);
			toastError(messageOf(error, "Could not disconnect this agent"));
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
					"Coding agents connected over MCP. Each acts as itself, in every workspace you belong to, and can never do more than you can.",
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
								Div({ class: "truncate text-[13px]" }, agent.bind("name")),
								Div(
									{ class: "truncate text-[12px] text-muted-foreground" },
									agent.bind((value) => summarize(value.scopes)),
								),
								// Two installs of the same agent are the same name and the
								// same scopes, so when they were connected is what tells them
								// apart — that and which one has gone quiet.
								Div(
									{ class: "text-[11px] text-muted-foreground" },
									agent.bind((value) =>
										[
											`Connected ${relativeTime(value.createdAt)}`,
											value.lastUsedAt === null
												? "never used"
												: `last used ${relativeTime(value.lastUsedAt)}`,
										].join(" · "),
									),
								),
							),
							Button({
								size: "icon-sm",
								variant: "ghost",
								"aria-label": "Disconnect",
								onClick: () => void revoke(agent.get().grantId),
								children: Trash2({ class: "size-3.5", "aria-hidden": true }),
							}),
						),
				),
			),
		),

		If(
			agents.bind((list) => list.length === 0),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"No agents yet. Connect one and approve it once in your browser.",
			),
		),

		ConnectDialog(connecting, copy),
	);
}

/** "Read and write issues, read workspace" — what the grant actually allows. */
function summarize(scopes: string[]): string {
	const described = describeScopes(scopes);
	if (described.length === 0) return "No access";
	return described.map((entry) => entry.label).join(", ");
}

/**
 * The MCP server URL an agent is pointed at.
 *
 * One URL for the whole app rather than one per workspace: which workspaces an
 * agent can act in comes from who authorized it, so the URL does not carry one
 * — and an agent cannot reach further by editing a string.
 */
function mcpUrl(origin: string): string {
	return `${origin}/api/mcp`;
}

/** What someone pastes into a harness that takes a JSON config. */
function mcpConfig(origin: string): string {
	return JSON.stringify(
		{ mcpServers: { tracker: { type: "http", url: mcpUrl(origin) } } },
		null,
		2,
	);
}

/** How to point an agent at the MCP server. */
function ConnectDialog(open: Signal<boolean>, copy: (value: string) => Promise<void>) {
	const origin = signal("");
	// Which of the two things was copied last, so only that button confirms.
	const copied = signal<"" | "url" | "config" | "cli">("");

	const doCopy = async (what: "url" | "config" | "cli") => {
		const value =
			what === "url"
				? mcpUrl(origin.get())
				: what === "cli"
					? `claude mcp add --transport http tracker ${mcpUrl(origin.get())}`
					: mcpConfig(origin.get());
		await copy(value);
		copied.set(what);
		setTimeout(() => {
			if (copied.get() === what) copied.set("");
		}, 2000);
	};

	const copyButton = (what: "url" | "config" | "cli", label: string) =>
		Button(
			{ size: "xs", variant: "secondary", class: "text-[11px]", onClick: () => void doCopy(what) },
			If(
				copied.bind((current) => current === what),
				Check({ class: "size-3", "aria-hidden": true }),
			),
			If(
				copied.bind((current) => current !== what),
				Copy({ class: "size-3", "aria-hidden": true }),
			),
			copied.bind((current) => (current === what ? "Copied" : label)),
		);

	const steps: [string, string][] = [
		[
			"Add the server to your agent",
			"Claude Code takes the command below. Cursor and most others take the JSON.",
		],
		[
			"It opens a browser the first time it connects",
			"It registers itself and sends you here — you never paste a key.",
		],
		[
			"Confirm what it is, and approve",
			"What you pick is the name and mark its comments and issues will carry.",
		],
		[
			"That is the last time you are asked",
			"It renews its own credential, and reaches every workspace you belong to. Disconnect it here to stop it.",
		],
	];

	const block = (
		label: string,
		what: "url" | "config" | "cli",
		value: () => string,
		wrap: string,
	) =>
		Div(
			{ class: "flex flex-col gap-1.5" },
			Div(
				{ class: "flex items-center justify-between gap-2" },
				Span({ class: "text-[12px] font-medium" }, label),
				copyButton(what, "Copy"),
			),
			Pre(
				{
					class: `overflow-auto rounded-md border border-border bg-background p-2.5 font-mono text-[10px] leading-relaxed ${wrap}`,
				},
				origin.bind((current) => (current === "" ? "" : value())),
			),
		);

	return ResponsiveDialog(
		{ open },
		// The origin is only known in the browser, and every snippet is useless
		// without it — an agent cannot guess where this app lives.
		ImplementLifecycle({ onMount: () => origin.set(window.location.origin) }),
		ResponsiveDialogContent(
			{ class: cn("gap-0 p-0 md:max-w-lg", RESPONSIVE_DIALOG_PANEL) },
			ResponsiveDialogHeader(
				{},
				Div(
					{ class: "flex items-center gap-2" },
					McpLogo(),
					DialogTitle({ class: "text-[15px] font-semibold" }, "Connect over MCP"),
				),
				DialogDescription(
					{ class: "text-[12px]" },
					"Your agent authenticates as itself. You approve it once, in a browser, and it stays connected until you disconnect it here.",
				),
			),

			ResponsiveDialogBody(
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

				block(
					"Claude Code",
					"cli",
					() => `claude mcp add --transport http tracker ${mcpUrl(origin.get())}`,
					"whitespace-pre-wrap text-foreground",
				),
				block(
					"Server URL",
					"url",
					() => mcpUrl(origin.get()),
					"whitespace-pre-wrap text-foreground",
				),
				block(
					"Or as JSON config",
					"config",
					() => mcpConfig(origin.get()),
					"max-h-40 whitespace-pre text-muted-foreground",
				),
			),

			// Nothing but a Done that the drawer's close button already is.
			ResponsiveDialogFooter(
				Button({ size: "sm", variant: "secondary", onClick: () => open.set(false) }, "Done"),
			),
		),
	);
}
