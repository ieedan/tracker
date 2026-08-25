/**
 * One click from feedback to issue.
 *
 * The click itself does the whole thing — team defaults to the workspace's
 * first, priority to none — because the point of the button is that triage does
 * not stall on a form. The dropdown beside it is there for the times you
 * already know which team it belongs to.
 */
import { navigateTo } from "@implementjs/core";
import { Div, ForEach, Span, signal, type Readable, type Signal } from "@implementjs/core";
import { ChevronDown, GitBranchPlus } from "@implementjs/lucide";
import { api, messageOf } from "@/lib/client/api";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import type { Feedback, Issue, Team } from "@/lib/domain/schemas";

export interface ConvertOptions {
	slug: Readable<string>;
	feedback: Readable<Feedback>;
	teams: Readable<Team[]>;
	/** Updated in place so the row shows its new issue without a reload. */
	list?: Signal<Feedback[]>;
	/** Go to the new issue instead of staying put. */
	navigate?: boolean;
	onConverted?: (issue: Issue) => void;
}

export async function convertFeedback(
	options: ConvertOptions,
	teamKey?: string,
): Promise<Issue | null> {
	const entry = options.feedback.get();

	const { data, error } = await api.POST("/api/v1/workspaces/[slug]/user-feedback/[id]/convert", {
		params: { slug: options.slug.get(), id: entry.id },
		body: teamKey === undefined ? {} : { teamKey },
	});

	if (error !== undefined) {
		toastError(messageOf(error, "Could not convert this feedback"));
		return null;
	}

	options.list?.update((list) =>
		list.map((value) =>
			value.id === entry.id
				? {
						...value,
						// Converting settles the triage too — mirror what the server did
						// rather than leaving the row showing "New".
						status: "accepted",
						issue: { id: data.id, identifier: data.identifier, title: data.title },
					}
				: value,
		),
	);

	toastSuccess(`${entry.identifier} is now ${data.identifier}`);
	options.onConverted?.(data);

	if (options.navigate === true) {
		navigateTo(`/app/${options.slug.get()}/issue/${data.identifier}`);
	}
	return data;
}

export function ConvertButton(options: ConvertOptions) {
	const busy = signal(false);

	const run = async (teamKey?: string) => {
		if (busy.get()) return;
		busy.set(true);
		await convertFeedback(options, teamKey);
		busy.set(false);
	};

	// A split control: the wide half converts straight away with the defaults,
	// the narrow half opens the team list. Putting the team behind a menu that
	// you *have* to open would make "one click" two.
	return Div(
		{ class: "flex items-center" },
		Button(
			{
				variant: "secondary",
				size: "sm",
				class: "h-6 gap-1 rounded-r-none px-2 text-[11px]",
				disabled: busy,
				title: "Create an issue from this feedback",
				onClick: () => void run(),
			},
			GitBranchPlus({ class: "size-3" }),
			busy.bind((value) => (value ? "Converting…" : "Convert")),
		),
		DropdownMenu(
			DropdownMenuTrigger(
				{
					variant: "secondary",
					size: "sm",
					class: "h-6 rounded-l-none border-l border-border/60 px-1",
					disabled: busy,
					title: "Choose a team",
				},
				ChevronDown({ class: "size-3" }),
			),
			DropdownMenuContent(
				{ class: "w-56", align: "end" },
				DropdownMenuGroup(
					DropdownMenuGroupHeading("File the issue in"),
					ForEach(
						options.teams,
						(team) => team.id,
						(team) =>
							DropdownMenuItem(
								{ onSelect: () => void run(team.get().key) },
								Span(
									{ class: "w-10 shrink-0 font-mono text-[11px] text-muted-foreground" },
									team.bind("key"),
								),
								Span({ class: "flex-1 truncate" }, team.bind("name")),
							),
					),
				),
			),
		),
	);
}
