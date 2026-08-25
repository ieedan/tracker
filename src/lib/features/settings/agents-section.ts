// Agents authorized into this workspace. Unlike API keys, these belong to the
// workspace rather than to a person, so this list is shared: everyone sees the
// same agents, and an admin can revoke one someone else set up.
import {
	Div,
	ForEach,
	H2,
	If,
	ImplementLifecycle,
	P,
	Span,
	signal,
	type Readable,
} from "@implementjs/core";
import { Trash2 } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { describeScopes } from "@/lib/domain/agents";
import type { InstalledAgent } from "@/lib/domain/schemas";
import { relativeTime } from "@/lib/format";

export function AgentsSection(slug: Readable<string>) {
	const agents = signal<InstalledAgent[]>([]);

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
			{},
			H2({ class: "text-[14px] font-semibold" }, "Agents"),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"Applications authorized to act in this workspace. Each one is a member in its own right, so its comments and issues appear under its own name.",
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
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"No agents yet. Run an agent's connect command and approve the code it shows you.",
			),
		),
	);
}

/** "Read and write issues, read workspace" — what the grant actually allows. */
function summarize(scopes: string[]): string {
	const described = describeScopes(scopes);
	if (described.length === 0) return "No access";
	return described.map((entry) => entry.label).join(", ");
}
