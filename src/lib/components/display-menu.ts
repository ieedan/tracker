import { router } from "$implement/router";
import { Implement, signal, type Mountable, type Signal } from "@implementjs/core";
import type { SearchParam } from "@implementjs/core";
import { SlidersHorizontalIcon } from "@implementjs/lucide";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Linear's other header control: how the list is grouped and ordered.
 *
 * Like the filters these live in the query string, so a view is a link — but
 * because `searchParam` drops a value equal to its fallback, the defaults
 * leave no trace and the URL stays clean until you change something.
 */

export const GROUPINGS = ["status", "priority", "assignee", "repo", "none"] as const;
export type Grouping = (typeof GROUPINGS)[number];

export const ORDERINGS = ["manual", "priority", "updated", "created", "title"] as const;
export type Ordering = (typeof ORDERINGS)[number];

const GROUPING_LABELS: Record<Grouping, string> = {
	status: "Status",
	priority: "Priority",
	assignee: "Assignee",
	repo: "Repo",
	none: "No grouping",
};

const ORDERING_LABELS: Record<Ordering, string> = {
	manual: "Manual",
	priority: "Priority",
	updated: "Last updated",
	created: "Created",
	title: "Title",
};

export type DisplayOptions = {
	grouping: Signal<Grouping>;
	ordering: Signal<Ordering>;
	/** Mount this to keep the query string and the options in step. */
	Sync: Mountable;
};

function isGrouping(value: string): value is Grouping {
	return (GROUPINGS as readonly string[]).includes(value);
}

function isOrdering(value: string): value is Ordering {
	return (ORDERINGS as readonly string[]).includes(value);
}

export function createDisplayOptions(): DisplayOptions {
	const groupParam: SearchParam<string> = router.searchParam("group", "status");
	const orderParam: SearchParam<string> = router.searchParam("order", "manual");

	const initialGroup = groupParam.get();
	const initialOrder = orderParam.get();

	const grouping = signal<Grouping>(isGrouping(initialGroup) ? initialGroup : "status");
	const ordering = signal<Ordering>(isOrdering(initialOrder) ? initialOrder : "manual");

	const Sync = Implement.Lifecycle({
		onMount: () => {
			const unsubscribes = [
				grouping.onChange((next) => {
					if (next !== groupParam.get()) groupParam.set(next);
				}),
				groupParam.onChange((next) => {
					if (isGrouping(next) && next !== grouping.get()) grouping.set(next);
				}),
				ordering.onChange((next) => {
					if (next !== orderParam.get()) orderParam.set(next);
				}),
				orderParam.onChange((next) => {
					if (isOrdering(next) && next !== ordering.get()) ordering.set(next);
				}),
			];

			return () => {
				for (const unsubscribe of unsubscribes) unsubscribe();
			};
		},
	});

	return { grouping, ordering, Sync };
}

export function DisplayMenu({ grouping, ordering }: DisplayOptions) {
	// The radio group drives a `Signal<string | null>`; these bridge it to the
	// narrower type without pretending one is the other.
	const groupingValue = grouping.bind<string | null>(
		(value) => value,
		(previous, next) => (next !== null && isGrouping(next) ? next : previous),
	);
	const orderingValue = ordering.bind<string | null>(
		(value) => value,
		(previous, next) => (next !== null && isOrdering(next) ? next : previous),
	);

	return DropdownMenu(
		DropdownMenuTrigger(
			{
				"aria-label": "Display options",
				title: "Display",
				class: cn(
					"inline-flex size-7 items-center justify-center rounded-md text-muted-foreground",
					"transition-colors hover:bg-accent hover:text-foreground",
				),
			},
			SlidersHorizontalIcon({ class: "size-4" }),
		),
		DropdownMenuContent(
			{ align: "end", class: "w-52" },

			DropdownMenuRadioGroup(
				{ value: groupingValue },
				// The heading lives inside the group: it reads the group's context
				// for its labelling, and has no provider outside one.
				DropdownMenuGroupHeading("Grouping"),
				...GROUPINGS.map((value) =>
					DropdownMenuRadioItem({ value, closeOnSelect: false }, GROUPING_LABELS[value]),
				),
			),

			DropdownMenuSeparator(),

			DropdownMenuRadioGroup(
				{ value: orderingValue },
				DropdownMenuGroupHeading("Ordering"),
				...ORDERINGS.map((value) =>
					DropdownMenuRadioItem({ value, closeOnSelect: false }, ORDERING_LABELS[value]),
				),
			),
		),
	);
}
