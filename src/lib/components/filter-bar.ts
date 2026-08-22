import { router } from "$implement/router";
import type { SearchParam } from "@implementjs/core";
import {
	Div,
	ForEach,
	If,
	Implement,
	Span,
	derived,
	signal,
	type Mountable,
	type Readable,
	type Signal,
} from "@implementjs/core";
import {
	CircleDashedIcon,
	FolderGit2Icon,
	ListFilterIcon,
	SignalHighIcon,
	TagIcon,
	UserIcon,
	XIcon,
} from "@implementjs/lucide";
import { UserAvatar } from "@/lib/components/issue-row";
import { PriorityIcon } from "@/lib/components/priority-icon";
import { StatusIcon } from "@/lib/components/status-icon";
import { Button } from "@/lib/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import { PRIORITIES, PRIORITY_LABELS, type UserDto } from "@/lib/types";
import type { WorkspaceStore } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

/**
 * Linear's filter model: one menu, a submenu per dimension, and a chip per
 * dimension you have narrowed.
 *
 * The state lives in the query string rather than in the component, so a
 * filtered view is a URL you can share, reload, and go back to.
 */

export type IssueFilterState = {
	status: Signal<string[]>;
	priority: Signal<string[]>;
	label: Signal<string[]>;
	repo: Signal<string[]>;
	assignee: Signal<string[]>;
	/** Every dimension, so a caller can watch them all with one subscription. */
	all: readonly Signal<string[]>[];
	/** Mount this to keep the query string and the filters in step. */
	Sync: Mountable;
	clear: () => void;
};

const DIMENSIONS = ["status", "priority", "label", "repo", "assignee"] as const;

const split = (csv: string): string[] => (csv === "" ? [] : csv.split(","));
const same = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Filters live in the query string, so a narrowed view is a URL you can share,
 * reload, and go back to.
 *
 * The signals are ordinary ones rather than the router's `searchParam`, which
 * is read-only apart from `set` and throws if written during a server render.
 * They are seeded from the URL — including on the server, so a shared link
 * renders filtered — and kept in step in both directions once mounted.
 */
export function createIssueFilters(): IssueFilterState {
	const params = Object.fromEntries(
		DIMENSIONS.map((name) => [name, router.searchParam(name, "")]),
	) as Record<(typeof DIMENSIONS)[number], SearchParam<string>>;

	const signals = Object.fromEntries(
		DIMENSIONS.map((name) => [name, signal<string[]>(split(params[name].get()))]),
	) as Record<(typeof DIMENSIONS)[number], Signal<string[]>>;

	const all = DIMENSIONS.map((name) => signals[name]);

	const Sync = Implement.Lifecycle({
		onMount: () => {
			const unsubscribes = DIMENSIONS.flatMap((name) => [
				// A change here rewrites the query string…
				signals[name].onChange((next) => {
					if (!same(next, split(params[name].get()))) params[name].set(next.join(","));
				}),
				// …and a change there — back, forward, a pasted link — comes back.
				params[name].onChange((csv) => {
					const next = split(csv);
					if (!same(next, signals[name].get())) signals[name].set(next);
				}),
			]);

			return () => {
				for (const unsubscribe of unsubscribes) unsubscribe();
			};
		},
	});

	return {
		...signals,
		all,
		Sync,
		clear: () => {
			for (const dimension of all) dimension.set([]);
		},
	};
}

/**
 * A two-way boolean for one option of one dimension. The menu's checkbox items
 * bind a `Signal<boolean>`, so membership of the array has to be expressible
 * as one — reading tells the box whether to tick, writing adds or removes.
 */
function membership(list: Signal<string[]>, value: string): Signal<boolean> {
	return list.bind(
		(all) => all.includes(value),
		(previous, next) =>
			next ? [...previous, ...(previous.includes(value) ? [] : [value])] : previous.filter((id) => id !== value),
	);
}

type Option = { value: string; label: string; icon?: Mountable };

/** One submenu: a dimension, and the options you can narrow it to. */
function Dimension(
	label: string,
	icon: Mountable,
	list: Signal<string[]>,
	options: Readable<Option[]>,
) {
	return DropdownMenuSub(
		DropdownMenuSubTrigger({}, icon, label),
		DropdownMenuSubContent(
			{ class: "max-h-72 w-56 overflow-y-auto" },
			ForEach(
				options,
				(option) => option.value,
				(option) =>
					DropdownMenuCheckboxItem(
						{
							checked: membership(list, option.get().value),
							// Narrowing usually means ticking several boxes, so the menu
							// stays open until you dismiss it.
							closeOnSelect: false,
						},
						Div(
							{ class: "flex min-w-0 items-center gap-2" },
							option.get().icon ?? Span({ class: "size-4 shrink-0" }),
							Span({ class: "truncate" }, option.bind("label")),
						),
					),
			),
		),
	);
}

/** The chip shown for a dimension you have narrowed, with the values spelled out. */
function Chip(name: string, list: Signal<string[]>, options: Readable<Option[]>) {
	const summary = derived([list, options], (selected, available) => {
		const labels = selected.map(
			(value) => available.find((option) => option.value === value)?.label ?? value,
		);
		if (labels.length === 0) return "";
		if (labels.length <= 2) return labels.join(", ");
		return `${labels.length} ${name.toLowerCase()}s`;
	});

	return If(list.bind((selected) => selected.length > 0)).Then(
		Div(
			{
				class:
					"flex items-center gap-1.5 rounded-md border bg-background py-1 pr-1 pl-2 text-xs whitespace-nowrap",
			},
			Span({ class: "text-muted-foreground" }, name),
			Span({ class: "text-muted-foreground" }, list.bind((s) => (s.length > 1 ? "is any of" : "is"))),
			Span({ class: "max-w-40 truncate font-medium" }, summary),
			Button(
				{
					variant: "ghost",
					size: "icon-xs",
					"aria-label": `Clear ${name.toLowerCase()} filter`,
					onClick: () => list.set([]),
				},
				XIcon({ class: "size-3" }),
			),
		),
	);
}

export type FilterOptions = Record<
	(typeof DIMENSIONS)[number],
	{ name: string; icon: Mountable; options: Readable<Option[]> }
>;

/**
 * The options behind each dimension, built once and shared: the menu and the
 * chip row render from the same list, and they sit in different rows of the
 * header.
 */
export function filterOptions(store: WorkspaceStore, members: Readable<UserDto[]>): FilterOptions {
	return {
		status: {
			name: "Status",
			icon: CircleDashedIcon({ class: "size-4" }),
			options: store.statuses.bind((statuses) =>
				statuses.map((status) => ({
					value: status.id,
					label: status.name,
					icon: StatusIcon(status),
				})),
			),
		},
		priority: {
			name: "Priority",
			icon: SignalHighIcon({ class: "size-4" }),
			options: signal<Option[]>(
				PRIORITIES.map((priority) => ({
					value: String(priority),
					label: PRIORITY_LABELS[priority],
					icon: PriorityIcon(priority),
				})),
			),
		},
		assignee: {
			name: "Assignee",
			icon: UserIcon({ class: "size-4" }),
			options: members.bind((people) =>
				people.map((person) => ({
					value: person.id,
					label: person.name,
					icon: UserAvatar(person, "size-4"),
				})),
			),
		},
		label: {
			name: "Label",
			icon: TagIcon({ class: "size-4" }),
			options: store.labels.bind((labels) =>
				labels.map((label) => ({
					value: label.id,
					label: label.name,
					icon: Span({
						class: "ml-0.5 size-2.5 shrink-0 rounded-full",
						style: { backgroundColor: label.color },
					}),
				})),
			),
		},
		repo: {
			name: "Repo",
			icon: FolderGit2Icon({ class: "size-4" }),
			options: store.repos.bind((repos) => [
				{
					value: "none",
					label: "No repo",
					icon: FolderGit2Icon({ class: "size-4 opacity-40" }),
				},
				...repos.map((repo) => ({
					value: repo.id,
					label: repo.name,
					icon: FolderGit2Icon({ class: "size-4 opacity-70" }),
				})),
			]),
		},
	};
}

/** The `Filter` control itself — one menu, a submenu per dimension. */
export function FilterMenu(filters: IssueFilterState, options: FilterOptions) {
	return DropdownMenu(
		DropdownMenuTrigger(
			{
				// Icon only, the way Linear's header reads. The label still has to
				// exist for anyone not looking at it, and `title` gives sighted
				// users the same words on hover.
				"aria-label": "Filter issues",
				title: "Filter",
				class: cn(
					"inline-flex size-7 items-center justify-center rounded-md text-muted-foreground",
					"transition-colors hover:bg-accent hover:text-foreground",
				),
			},
			ListFilterIcon({ class: "size-4" }),
		),
		DropdownMenuContent(
			{ align: "end", class: "w-44" },
			...DIMENSIONS.map((name) =>
				Dimension(options[name].name, options[name].icon, filters[name], options[name].options),
			),
		),
	);
}

/**
 * The row of applied filters. Renders nothing until something is narrowed,
 * which is what keeps the header one line until it needs to be two.
 */
export function FilterChips(filters: IssueFilterState, options: FilterOptions) {
	const anyActive = derived(filters.all, (...selected) =>
		selected.some((values) => values.length > 0),
	);

	return If(anyActive).Then(
		Div(
			{ class: "flex flex-wrap items-center gap-1.5 border-b px-4 py-2" },
			...DIMENSIONS.map((name) =>
				Chip(options[name].name, filters[name], options[name].options),
			),
			Button(
				{
					variant: "ghost",
					size: "xs",
					class: "ml-auto text-muted-foreground",
					onClick: filters.clear,
				},
				"Clear all",
			),
		),
	);
}
