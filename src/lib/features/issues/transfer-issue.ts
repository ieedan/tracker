import { router } from "$implement/router";
import {
	derived,
	Div,
	ForEach,
	ImplementEffect,
	Span,
	signal,
	type Readable,
} from "@implementjs/core";
import { ArrowRight } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { Label } from "@/lib/components/ui/label";
import { preferDefaultTeam } from "@/lib/domain/issues";
import type { Issue, Team, TeamRef, Workspace } from "@/lib/domain/schemas";
import { TeamPicker } from "./pickers";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

export interface TransferIssueButtonProps {
	slug: Readable<string>;
	issue: Readable<Issue>;
}

export function TransferIssueButton({ slug, issue }: TransferIssueButtonProps) {
	const open = signal(false);
	const workspaces = signal<Workspace[]>([]);
	const dest = signal<Workspace | null>(null);
	const teams = signal<Team[]>([]);
	const chosenTeam = signal<TeamRef | null>(null);
	const submitting = signal(false);

	const destinations = derived([workspaces, slug], (list, current) =>
		list.filter((workspace) => workspace.slug !== current),
	);
	const canTransfer = destinations.bind((list) => list.length > 0);

	const loadWorkspaces = async () => {
		const { data, error } = await api.GET("/api/v1/workspaces");
		if (error !== undefined) return;
		workspaces.set(data);
	};

	const loadTeams = async (workspaceSlug: string) => {
		const { data, error } = await api.GET("/api/v1/workspaces/[slug]/teams", {
			params: { slug: workspaceSlug },
		});
		if (error !== undefined) {
			teams.set([]);
			chosenTeam.set(null);
			return;
		}
		teams.set(data);
		const picked = preferDefaultTeam(data);
		chosenTeam.set(
			picked === undefined ? null : { id: picked.id, name: picked.name, key: picked.key },
		);
	};

	void loadWorkspaces();

	const submit = async () => {
		const workspace = dest.get();
		const team = chosenTeam.get();
		if (workspace === null || team === null) return;

		submitting.set(true);
		const { data, error } = await api.POST(
			"/api/v1/workspaces/[slug]/issues/[identifier]/transfer",
			{
				params: { slug: slug.get(), identifier: issue.get().identifier },
				body: { workspaceSlug: workspace.slug, teamKey: team.key },
			},
		);
		submitting.set(false);

		if (error !== undefined) {
			toastError(messageOf(error, "Could not transfer this issue"));
			return;
		}

		toastSuccess(`Transferred to ${data.identifier}`);
		open.set(false);
		router.navigate("/app/:slug/issue/:identifier", {
			slug: workspace.slug,
			identifier: data.identifier,
		});
	};

	return Div(
		{},
		Button(
			{
				variant: "ghost",
				size: "sm",
				class: triggerClass,
				disabled: canTransfer.bind((ok) => !ok),
				title: canTransfer.bind((ok) =>
					ok
						? "Transfer to another workspace"
						: "Join or create another workspace to transfer this issue",
				),
				onClick: () => {
					if (!canTransfer.get()) return;
					open.set(true);
				},
			},
			ArrowRight({ class: "size-3.5" }),
			"Transfer",
		),
		Dialog(
			{ open },
			ImplementEffect([open], (isOpen) => {
				if (!isOpen) return;
				void loadWorkspaces();
				dest.set(null);
				teams.set([]);
				chosenTeam.set(null);
			}),
			ImplementEffect([dest], (workspace) => {
				if (workspace === null) {
					teams.set([]);
					chosenTeam.set(null);
					return;
				}
				void loadTeams(workspace.slug);
			}),
			DialogContent(
				{ class: "max-w-md gap-0 p-0" },
				Div(
					{ class: "flex flex-col gap-1 border-b border-border px-4 py-3" },
					DialogTitle({ class: "text-[15px] font-semibold" }, "Transfer issue"),
					DialogDescription(
						{ class: "text-[12px]" },
						"Move this issue to another workspace. It gets a new identifier; labels without a matching name are dropped, and linked feedback stays here.",
					),
				),

				Div(
					{ class: "flex flex-col gap-4 px-4 py-4" },
					Div(
						{ class: "flex flex-col gap-1.5" },
						Label({ class: "text-[13px]" }, "Workspace"),
						DropdownMenu(
							DropdownMenuTrigger(
								{
									variant: "outline",
									class: "h-9 w-full justify-start px-3 text-[13px] font-normal",
								},
								Span(
									{
										class: dest.bind((workspace) =>
											workspace === null ? "text-muted-foreground" : "",
										),
									},
									dest.bind((workspace) => workspace?.name ?? "Choose a workspace"),
								),
							),
							DropdownMenuContent(
								{ class: "w-64", align: "start" },
								DropdownMenuGroup(
									DropdownMenuGroupHeading("Workspace"),
									ForEach(
										destinations,
										(workspace) => workspace.id,
										(workspace) =>
											DropdownMenuItem(
												{ onSelect: () => dest.set(workspace.get()) },
												Span({ class: "flex-1 truncate" }, workspace.bind("name")),
												Span(
													{ class: "font-mono text-[11px] text-muted-foreground" },
													workspace.bind("slug"),
												),
											),
									),
								),
							),
						),
					),
					Div(
						{ class: "flex flex-col gap-1.5" },
						Label({ class: "text-[13px]" }, "Team"),
						TeamPicker(
							chosenTeam,
							teams,
							(key) => {
								const picked = teams.get().find((team) => team.key === key);
								if (picked !== undefined) {
									chosenTeam.set({ id: picked.id, name: picked.name, key: picked.key });
								}
							},
							{ showLabel: true, class: "h-9 border border-border" },
						),
					),
				),

				Div(
					{ class: "flex items-center justify-end gap-2 border-t border-border px-4 py-2.5" },
					Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
					Button(
						{
							size: "sm",
							loading: submitting,
							disabled: derived(
								[dest, chosenTeam],
								(workspace, team) => workspace === null || team === null,
							),
							onClick: () => void submit(),
						},
						"Transfer",
					),
				),
			),
		),
	);
}
