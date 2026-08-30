import { router } from "$implement/router";
import {
	derived,
	Div,
	ForEach,
	ImplementEffect,
	Span,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { ArrowRight } from "@implementjs/lucide";
import { api } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
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
import { cn } from "@/lib/utils";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

export interface TransferTarget {
	id: string;
	identifier: string;
}

export interface TransferIssueButtonProps {
	slug: Readable<string>;
	issue: Readable<Issue>;
}

export function TransferIssueButton({ slug, issue }: TransferIssueButtonProps) {
	const open = signal(false);
	const targets = issue.bind((value) => [{ id: value.id, identifier: value.identifier }]);

	return Div(
		{},
		TransferTrigger({ slug, open }),
		TransferIssueDialog({
			slug,
			targets,
			open,
			onTransferred: (moved, workspaceSlug) => {
				const first = moved[0];
				if (first === undefined) return;
				router.navigate("/app/:slug/issue/:identifier", {
					slug: workspaceSlug,
					identifier: first.identifier,
				});
			},
		}),
	);
}

export function TransferTrigger({
	slug,
	open,
	class: className,
}: {
	slug: Readable<string>;
	open: Signal<boolean>;
	class?: string;
}) {
	const workspaces = signal<Workspace[]>([]);
	const destinations = derived([workspaces, slug], (list, current) =>
		list.filter((workspace) => workspace.slug !== current),
	);
	const canTransfer = destinations.bind((list) => list.length > 0);

	void api.GET("/api/v1/workspaces").then(({ data, error }) => {
		if (error === undefined) workspaces.set(data);
	});

	return Button(
		{
			variant: "ghost",
			size: "sm",
			class: className ?? triggerClass,
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
	);
}

export interface TransferIssueDialogProps {
	slug: Readable<string>;
	targets: Readable<TransferTarget[]>;
	open: Signal<boolean>;
	onTransferred?: (moved: Issue[], workspaceSlug: string) => void;
}

export function TransferIssueDialog({
	slug,
	targets,
	open,
	onTransferred,
}: TransferIssueDialogProps) {
	const workspaces = signal<Workspace[]>([]);
	const dest = signal<Workspace | null>(null);
	const teams = signal<Team[]>([]);
	const chosenTeam = signal<TeamRef | null>(null);
	const submitting = signal(false);

	const destinations = derived([workspaces, slug], (list, current) =>
		list.filter((workspace) => workspace.slug !== current),
	);

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
			picked === undefined
				? null
				: {
						id: picked.id,
						name: picked.name,
						key: picked.key,
						icon: picked.icon,
						color: picked.color,
					},
		);
	};

	const count = targets.bind((list) => list.length);

	const submit = async () => {
		const workspace = dest.get();
		const team = chosenTeam.get();
		const list = targets.get();
		if (workspace === null || team === null || list.length === 0) return;

		submitting.set(true);
		const moved: Issue[] = [];
		let failed = 0;

		for (const target of list) {
			const { data, error } = await api.POST(
				"/api/v1/workspaces/[slug]/issues/[identifier]/transfer",
				{
					params: { slug: slug.get(), identifier: target.identifier },
					body: { workspaceSlug: workspace.slug, teamKey: team.key },
				},
			);
			if (error !== undefined || data === undefined) {
				failed += 1;
				continue;
			}
			moved.push(data);
		}

		submitting.set(false);

		if (moved.length === 0) {
			toastError(
				list.length === 1 ? "Could not transfer this issue" : "Could not transfer the issues",
			);
			return;
		}

		if (failed > 0) {
			toastError(`Transferred ${moved.length}, ${failed} failed`);
		} else if (moved.length === 1) {
			toastSuccess(`Transferred to ${moved[0]!.identifier}`);
		} else {
			toastSuccess(`Transferred ${moved.length} issues`);
		}

		open.set(false);
		onTransferred?.(moved, workspace.slug);
	};

	/**
	 * The panel's one action, built into whichever corner it has for it — the
	 * drawer's top-right or the dialog's footer. Only one of the two is ever
	 * mounted, and both read the same signals.
	 */
	const TransferButton = () =>
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
		);

	return ResponsiveDialog(
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
		ResponsiveDialogContent(
			{ class: cn("gap-0 p-0 md:max-w-md", RESPONSIVE_DIALOG_PANEL) },
			ResponsiveDialogHeader(
				{ action: TransferButton },
				DialogTitle(
					{ class: "text-[15px] font-semibold" },
					count.bind((n) => (n === 1 ? "Transfer issue" : `Transfer ${n} issues`)),
				),
				DialogDescription(
					{ class: "text-[12px]" },
					count.bind((n) =>
						n === 1
							? "Move this issue to another workspace. It gets a new identifier; labels without a matching name are dropped, and linked feedback stays here."
							: "Move these issues to another workspace. Each gets a new identifier; labels without a matching name are dropped, and linked feedback stays here.",
					),
				),
			),

			ResponsiveDialogBody(
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
							{ class: "w-64", align: "start", search: "Search workspaces…", hotkeys: true },
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
								chosenTeam.set({
									id: picked.id,
									name: picked.name,
									key: picked.key,
									icon: picked.icon,
									color: picked.color,
								});
							}
						},
						{ showLabel: true, select: true },
					),
				),
			),

			ResponsiveDialogFooter(
				Button({ variant: "ghost", size: "sm", onClick: () => open.set(false) }, "Cancel"),
				TransferButton(),
			),
		),
	);
}
