// Which agents can act in this workspace, and who they act for.
//
// Read-only, and derived rather than stored: an agent reaches a workspace
// through a member's grant, so this list changes the moment someone disconnects
// it or leaves. There is nothing to revoke here that is not someone else's to
// disconnect from their own account settings.
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
import { api } from "@/lib/client/api";
import { HarnessLogo } from "@/lib/components/harness-logo";
import type { WorkspaceAgent } from "@/lib/domain/schemas";

export function WorkspaceAgentsSection(slug: Readable<string>) {
	const agents = signal<WorkspaceAgent[]>([]);

	const load = async () => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/agents", {
			params: { slug: slug.get() },
		});
		if (error === undefined) agents.set(data);
	};

	return Div(
		{ class: "flex flex-col gap-3" },
		ImplementLifecycle({ onMount: () => void load() }),

		Div(
			{},
			H2({ class: "text-[14px] font-semibold" }, "Agents"),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"Coding agents that can act here. An agent reaches this workspace through the person who connected it, so it can never do more than they can — and it stops when they disconnect it or leave.",
			),
		),

		If(
			agents.bind((list) => list.length > 0),
			Div(
				{ class: "flex flex-col divide-y divide-border rounded-md border border-border" },
				ForEach(
					agents,
					(agent) => agent.harness,
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
											`Acts for ${value.connectedBy.map((person) => person.name).join(", ")}`,
									),
								),
							),
						),
				),
			),
		),

		If(
			agents.bind((list) => list.length === 0),
			P(
				{ class: "text-[12px] text-muted-foreground" },
				"No agents can act here yet. Connect one from your account settings.",
			),
		),
	);
}
