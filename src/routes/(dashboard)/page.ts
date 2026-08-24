import { Div, ForEach, Fragment, Span, type Child, type Signal } from "@implementjs/core";
import { IssueManagerContext } from "@/lib/features/issues/issue-manager";
import type { Issue } from "@/lib/db/types";
import { Button } from "@/lib/components/ui/button";
import { SquarePenIcon } from "@implementjs/lucide";
import { StatusPicker } from "@/lib/features/issues/status-picker";
import { PriorityPicker } from "@/lib/features/issues/priority-picker";
import { LabelBadge } from "@/lib/features/issues/label-picker";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { router } from "$implement/router";
import { formatIssueId } from "@/lib/features/issues/utils";
import { PageContent, PageHeader } from "@/lib/components/page/page";
import { BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/lib/components/ui/breadcrumb";

export default function Page() {
	return Div(
		// H1("Issues"), 
		IssueList()
	);
}

function IssueList() {
	return IssueManagerContext.Use((manager) => {
		return Fragment({},
			IssueListHeader(),
			PageContent(
				Div({ class: 'flex flex-col' },
					ForEach(
						manager.issues,
						(item) => item.id,
						(item) => Issue(item),
					),
				),
			),
		)
	});
}

function IssueListHeader() {
	return IssueManagerContext.Use((manager) => {
		return PageHeader(
			Div({ class: 'flex items-center justify-between w-full' },
				BreadcrumbList({},
					BreadcrumbItem(BreadcrumbPage("Issues")),
				),
				Button({ variant: "ghost", size: 'icon', onClick: () => manager.openCreateIssueDialog() }, SquarePenIcon({}),),
			)
		)
	})
}

function Issue(issue: Signal<Issue>) {
	return router.Link(
		{
			to: "/issues/:id=issue-id",
			params: { id: issue.bind((issue) => formatIssueId(issue)) },
			class: 'border-b py-1 px-3 flex items-center justify-between',
		},
		Div({ class: 'flex items-center gap-2' },
			RowControl(Checkbox({})),
			RowControl(PriorityPicker({
				value: issue.bind('priority'),
				showLabel: false,
				class: 'border-none p-0 flex items-center justify-center size-8'
			})),
			Span({ class: 'text-muted-foreground font-mono text-sm w-15' }, issue.bind((issue) => formatIssueId(issue))),
			RowControl(StatusPicker({
				value: issue.bind("status"),
				showLabel: false,
				class: 'border-none p-0 flex items-center justify-center size-8'
			})),
			Span(issue.bind("title"))
		),
		Div({ class: 'flex items-center gap-2' },
			ForEach(issue.bind('labels'), (label) => label.id, (label) => LabelBadge(label)),
			Span({ class: 'text-muted-foreground text-sm' }, issue.bind((issue) => new Date(issue.createdAt).toDateString())),
		)
	);
}

/**
 * A control that lives inside the row's link. `preventDefault` is what `router.Link` checks before
 * it navigates, and it also cancels the browser's own anchor activation — the control's click
 * handler has already run by the time the event reaches this wrapper.
 */
function RowControl(...children: Child[]) {
	return Div(
		{
			class: 'flex items-center',
			onClick: (event) => {
				event.preventDefault();
				event.stopPropagation();
			},
		},
		...children,
	);
}
