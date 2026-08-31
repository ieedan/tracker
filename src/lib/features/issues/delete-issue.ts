/**
 * Deleting issues — the rail action on the details view, and the confirmation
 * both it and the bulk action put in front of you first.
 *
 * There is no trash and no undo: the row and everything hanging off it
 * (comments, activity, labels, attachments, the linked pull request) go with
 * it. So the dialog names what is about to go rather than counting it, and the
 * confirm button is the only destructive control on the screen.
 */
import { router } from "$implement/router";
import {
	Div,
	ForEach,
	If,
	ImplementEffect,
	P,
	Span,
	derived,
	signal,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Trash2 } from "@implementjs/lucide";
import { toastSuccess } from "@/lib/client/toast";
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
import type { Issue } from "@/lib/domain/schemas";
import { deleteIssues } from "./issue-store";
import { cn } from "@/lib/utils";

/** How many issues the confirmation names before it starts counting instead. */
const NAMED_LIMIT = 8;

export interface DeleteIssueButtonProps {
	slug: Readable<string>;
	issue: Readable<Issue>;
}

/** The rail action, next to Transfer and Copy prompt. */
export function DeleteIssueButton({ slug, issue }: DeleteIssueButtonProps) {
	const open = signal(false);
	const targets = issue.bind((value) => [value.id]);

	// A list of one, held apart from the page's own. The optimistic removal
	// empties whichever list it is given, and the details view renders straight
	// out of its first entry — so it is this copy that goes empty, not the one
	// under the page that is about to navigate away.
	const list = signal<Issue[]>([issue.get()]);

	return Div(
		{},
		ImplementEffect([issue], (value) => list.set([value])),
		Button(
			{
				variant: "ghost",
				size: "sm",
				class:
					"h-7 w-full justify-start gap-1.5 px-1.5 text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
				title: "Delete this issue",
				onClick: () => open.set(true),
			},
			Trash2({ class: "size-3.5" }),
			"Delete",
		),
		DeleteIssuesDialog({
			slug,
			issues: list,
			targets,
			open,
			// The issue this page is about no longer exists, so there is nothing
			// to stay on — back to the list it came from.
			onDeleted: (done) => {
				if (done.length === 0) return;
				router.navigate("/app/:slug", { slug: slug.get() });
			},
		}),
	);
}

export interface DeleteIssuesDialogProps {
	slug: Readable<string>;
	/** The list the rows are removed from, optimistically. */
	issues: Signal<Issue[]>;
	/** Ids of the issues to delete. */
	targets: Readable<string[]>;
	open: Signal<boolean>;
	/** The ids that are actually gone — empty when every delete was refused. */
	onDeleted?: (deleted: string[]) => void;
}

export function DeleteIssuesDialog({
	slug,
	issues,
	targets,
	open,
	onDeleted,
}: DeleteIssuesDialogProps) {
	const deleting = signal(false);

	const chosen = derived([issues, targets], (list, ids) => {
		const set = new Set(ids);
		return list.filter((issue) => set.has(issue.id));
	});

	// Snapshotted when the dialog opens. The optimistic removal empties `chosen`
	// the moment Delete is pressed, and a confirmation that blanks out while it
	// is still on screen reads like something went wrong.
	const pending = signal<Issue[]>([]);
	const named = pending.bind((list) => list.slice(0, NAMED_LIMIT));
	const rest = pending.bind((list) => Math.max(0, list.length - NAMED_LIMIT));
	const count = pending.bind((list) => list.length);

	const confirm = async () => {
		const list = pending.get();
		if (list.length === 0 || deleting.get()) return;

		deleting.set(true);
		const done = await deleteIssues(
			issues,
			slug.get(),
			list.map((issue) => issue.id),
		);
		deleting.set(false);

		// Everything was refused — `deleteIssues` has already said so, and the
		// rows are back, so leave the dialog up rather than pretending it worked.
		if (done.length === 0) return;

		if (done.length === list.length) {
			toastSuccess(
				list.length === 1 ? `Deleted ${list[0]!.identifier}` : `Deleted ${done.length} issues`,
			);
		}
		open.set(false);
		onDeleted?.(done);
	};

	/**
	 * The confirm, in whichever corner the panel has for it — the drawer's
	 * top-right or the dialog's footer. Only one of the two is ever mounted. The
	 * drawer's copy is the short label: a corner is not the place for "Delete 12
	 * issues", and the list of exactly which ones is right below it either way.
	 */
	const DeleteButton = (options: { long: boolean } = { long: true }) =>
		Button(
			{
				size: "sm",
				variant: "destructive",
				loading: deleting,
				onClick: () => void confirm(),
			},
			options.long
				? count.bind((n) => (n === 1 ? "Delete issue" : `Delete ${n} issues`))
				: "Delete",
		);

	return ResponsiveDialog(
		{ open },
		ImplementEffect([open], (isOpen) => {
			if (!isOpen) return;
			pending.set(chosen.get());
			deleting.set(false);
		}),
		ResponsiveDialogContent(
			{ class: cn("gap-0 p-0 md:max-w-md", RESPONSIVE_DIALOG_PANEL) },
			ResponsiveDialogHeader(
				{ action: () => DeleteButton({ long: false }) },
				DialogTitle(
					{ class: "text-[15px] font-semibold" },
					count.bind((n) => (n === 1 ? "Delete issue" : `Delete ${n} issues`)),
				),
				DialogDescription(
					{ class: "text-[12px]" },
					count.bind((n) =>
						n === 1
							? "This cannot be undone. The issue and its comments, activity, labels and attachments are deleted for everyone in the workspace."
							: `This cannot be undone. All ${n} issues — and their comments, activity, labels and attachments — are deleted for everyone in the workspace.`,
					),
				),
			),

			// Which ones, by name. Deleting the wrong issue is unrecoverable, so
			// the count alone is not enough to confirm against.
			ResponsiveDialogBody(
				{ class: "flex max-h-56 flex-col gap-1 px-4 py-3" },
				ForEach(
					named,
					(issue) => issue.id,
					(issue) =>
						Div(
							{ class: "flex min-w-0 items-baseline gap-2" },
							Span(
								{ class: "shrink-0 font-mono text-[11px] text-muted-foreground" },
								issue.bind("identifier"),
							),
							Span({ class: "min-w-0 flex-1 truncate text-[13px]" }, issue.bind("title")),
						),
				),
				If(
					rest.bind((n) => n > 0),
					P(
						{ class: "text-[12px] text-muted-foreground" },
						rest.bind((n) => `and ${n} more`),
					),
				),
			),

			ResponsiveDialogFooter(
				{ class: "py-3" },
				Button(
					{
						size: "sm",
						variant: "secondary",
						disabled: deleting,
						onClick: () => open.set(false),
					},
					"Cancel",
				),
				DeleteButton(),
			),
		),
	);
}
