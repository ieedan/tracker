import {
	Div,
	ForEach,
	If,
	ImplementDocument,
	ImplementEffect,
	ImplementLifecycle,
	Span,
	Switch,
	derived,
	signal,
	type ClassValue,
	type Readable,
	type Signal,
} from "@implementjs/core";
import {
	ArrowRight,
	ChevronLeft,
	FolderGit2,
	Link,
	Tag,
	Trash2,
	User,
	Users,
	X,
} from "@implementjs/lucide";
import { toastError, toastSuccess } from "@/lib/client/toast";
import { Button } from "@/lib/components/ui/button";
import { Checkbox } from "@/lib/components/ui/checkbox";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandGroupItems,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/lib/components/ui/command";
import { DialogDescription, DialogTitle } from "@/lib/components/ui/dialog";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/lib/components/ui/responsive-dialog";
import { PriorityIcon, StatusIcon, UnassignedAvatar, UserAvatar } from "@/lib/components/glyphs";
import {
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
	PRIORITY_LABELS,
	STATUS_LABELS,
	type IssuePriority,
	type IssueStatus,
} from "@/lib/domain/issues";
import type { Issue, Label, Member, Repository, Team, UserSummary } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";
import { patchIssues } from "./issue-store";
import { DeleteIssuesDialog } from "./delete-issue";
import { ProviderMark } from "./repository-picker";
import { TransferIssueDialog } from "./transfer-issue";

export type BulkView =
	| "root"
	| "status"
	| "priority"
	| "assignee"
	| "labels"
	| "team"
	| "repository";

/** ⌘K on the list page. Null off that page, so the shell palette stays in charge. */
let openBulkFromCommand: (() => boolean) | null = null;

/** True when a selection took ⌘K instead of the generic command palette. */
export function tryOpenBulkCommandPalette(): boolean {
	return openBulkFromCommand?.() ?? false;
}

const VIEW_TITLE: Record<BulkView, string> = {
	root: "Actions",
	status: "Change status",
	priority: "Set priority",
	assignee: "Assign to",
	labels: "Add labels",
	team: "Move to team",
	repository: "Set repository",
};

export function IssueCheckbox({
	checked,
	mixed,
	onChange,
	label,
	class: className,
}: {
	checked: Readable<boolean>;
	mixed?: Readable<boolean>;
	onChange: (checked: boolean) => void;
	label: string;
	class?: ClassValue;
}) {
	const value = signal(checked.get());
	const partial = signal(mixed?.get() ?? false);

	return Div(
		{ class: "contents" },
		ImplementEffect([checked], (next) => value.set(next)),
		mixed === undefined ? null : ImplementEffect([mixed], (next) => partial.set(next)),
		Checkbox({
			checked: value,
			indeterminate: partial,
			"aria-label": label,
			class: className,
			onCheckedChange: (next) => {
				value.set(next);
				partial.set(false);
				onChange(next);
			},
			onClick: (event: MouseEvent) => event.stopPropagation(),
		}),
	);
}

/** Select-all for a list of issues — mixed when only some of them are ticked. */
export function SelectIssuesCheckbox({
	selected,
	issues,
	label,
	class: className,
}: {
	selected: Signal<string[]>;
	issues: Readable<Issue[]>;
	label: string;
	class?: ClassValue;
}) {
	const checked = derived(
		[selected, issues],
		(ids, list) => list.length > 0 && list.every((issue) => ids.includes(issue.id)),
	);
	const mixed = derived([selected, issues], (ids, list) => {
		const n = list.filter((issue) => ids.includes(issue.id)).length;
		return n > 0 && n < list.length;
	});

	const toggle = (on: boolean) => {
		const list = issues.get();
		if (on) {
			selected.update((ids) => {
				const next = new Set(ids);
				for (const issue of list) next.add(issue.id);
				return [...next];
			});
			return;
		}
		const hide = new Set(list.map((issue) => issue.id));
		selected.update((ids) => ids.filter((id) => !hide.has(id)));
	};

	return IssueCheckbox({ checked, mixed, onChange: toggle, label, class: className });
}

/** Floating pill at the bottom of the list. Selecting never mutates issues. */
export function BulkSelectionBar({
	selected,
	open,
	view,
}: {
	selected: Signal<string[]>;
	open: Signal<boolean>;
	view: Signal<BulkView>;
}) {
	return If(
		selected.bind((ids) => ids.length > 0),
		Div(
			{
				class: "pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center",
			},
			Div(
				{
					class:
						"pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover py-1 pr-1 pl-3 shadow-lg",
				},
				Span(
					{ class: "text-[13px]" },
					selected.bind((ids) => `${ids.length} selected`),
				),
				Button(
					{
						variant: "outline",
						size: "sm",
						class: "h-7 gap-1.5 rounded-full px-2.5 text-[12px]",
						onClick: () => {
							view.set("root");
							open.set(true);
						},
					},
					Span({ class: "text-[11px] text-muted-foreground" }, "⌘"),
					"Actions",
				),
				Button(
					{
						variant: "ghost",
						size: "icon-xs",
						class: "size-7 rounded-full text-muted-foreground",
						"aria-label": "Clear selection",
						onClick: () => selected.set([]),
					},
					X({ class: "size-3.5" }),
				),
			),
		),
	);
}

export interface BulkActionsDialogProps {
	open: Signal<boolean>;
	view: Signal<BulkView>;
	slug: Readable<string>;
	userId: Readable<string>;
	issues: Signal<Issue[]>;
	selected: Signal<string[]>;
	members: Readable<Member[]>;
	labels: Readable<Label[]>;
	teams: Readable<Team[]>;
	/** Empty when the workspace has linked none — the action hides itself then. */
	repositories: Readable<Repository[]>;
}

export function BulkActionsDialog({
	open,
	view,
	slug,
	userId,
	issues,
	selected,
	members,
	labels,
	teams,
	repositories,
}: BulkActionsDialogProps) {
	const busy = signal(false);
	const transferOpen = signal(false);
	const deleteOpen = signal(false);
	const search = signal("");
	const searchRef = signal<HTMLInputElement | null>(null);
	let focusFrame: number | undefined;

	const focusSearch = () => {
		if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
		// The dialog focuses the first tabbable (the badge close). Steal it
		// back after that pass so typing goes into search.
		focusFrame = requestAnimationFrame(() => {
			focusFrame = undefined;
			searchRef.get()?.focus();
		});
	};

	const chosen = derived([issues, selected], (list, ids) => {
		const set = new Set(ids);
		return list.filter((issue) => set.has(issue.id));
	});

	const targets = chosen.bind((list) =>
		list.map((issue) => ({ id: issue.id, identifier: issue.identifier })),
	);

	const ids = () => selected.get();

	const go = (next: BulkView) => {
		search.set("");
		view.set(next);
		focusSearch();
	};

	const apply = (work: () => Promise<unknown>) => {
		if (busy.get() || ids().length === 0) return;
		busy.set(true);
		open.set(false);
		view.set("root");
		search.set("");
		void work().finally(() => busy.set(false));
	};

	const setStatus = (status: IssueStatus) =>
		apply(() =>
			patchIssues(issues, slug.get(), ids(), { status }, (value) => ({ ...value, status })),
		);

	const setPriority = (priority: IssuePriority) =>
		apply(() =>
			patchIssues(issues, slug.get(), ids(), { priority }, (value) => ({ ...value, priority })),
		);

	const setAssignee = (assigneeId: string | null) =>
		apply(() => {
			const user = resolveAssignee(members.get(), assigneeId);
			return patchIssues(issues, slug.get(), ids(), { assigneeId }, (value) => ({
				...value,
				assignee: assigneeId === null ? null : (user ?? value.assignee),
			}));
		});

	const assignToMe = () => setAssignee(userId.get());

	const addLabel = (labelId: string) =>
		apply(() => {
			const extra = labels.get().find((label) => label.id === labelId);
			return patchIssues(
				issues,
				slug.get(),
				ids(),
				(issue) => ({
					labelIds: issue.labels.some((label) => label.id === labelId)
						? issue.labels.map((label) => label.id)
						: [...issue.labels.map((label) => label.id), labelId],
				}),
				(value) => ({
					...value,
					labels: applyLabel(value.labels, extra, labelId, true),
				}),
			);
		});

	const setTeam = (key: string) => {
		const destination = teams.get().find((entry) => entry.key === key);
		if (destination === undefined) return;
		apply(() =>
			patchIssues(issues, slug.get(), ids(), { teamKey: key }, (value) => ({
				...value,
				team: destination,
			})),
		);
	};

	/** Scoping a set of issues to one repository, the same patch the rail sends. */
	const setRepository = (repositoryId: string | null) =>
		apply(() => {
			const repo = repositories.get().find((entry) => entry.id === repositoryId);
			return patchIssues(issues, slug.get(), ids(), { repositoryId }, (value) => ({
				...value,
				repository:
					repositoryId === null
						? null
						: repo === undefined
							? value.repository
							: { id: repo.id, fullName: repo.fullName, provider: repo.provider },
			}));
		});

	const hasRepositories = repositories.bind((list) => list.length > 0);

	const copyLinks = async () => {
		const list = chosen.get();
		if (list.length === 0) return;
		const origin = window.location.origin;
		const workspace = slug.get();
		const text = list
			.map((issue) => `${origin}/app/${workspace}/issue/${issue.identifier}`)
			.join("\n");
		try {
			await navigator.clipboard.writeText(text);
			toastSuccess(list.length === 1 ? "Copied issue link" : `Copied ${list.length} issue links`);
			open.set(false);
			view.set("root");
		} catch {
			toastError("Could not copy. Select and copy manually.");
		}
	};

	/**
	 * Unlike every other action here, this one cannot be taken back — so it
	 * hands off to a confirmation instead of going through `apply`, and the
	 * palette steps out of the way while that is on screen.
	 */
	const askDelete = () => {
		if (ids().length === 0) return;
		open.set(false);
		view.set("root");
		search.set("");
		deleteOpen.set(true);
	};

	const onCommandKey = (event: KeyboardEvent) => {
		if (!open.get()) return;

		if (event.key === "Escape" && view.get() !== "root") {
			event.preventDefault();
			event.stopPropagation();
			go("root");
			return;
		}

		if (event.key === "Backspace" && view.get() !== "root" && search.get() === "") {
			event.preventDefault();
			go("root");
			return;
		}

		if (event.metaKey || event.ctrlKey) {
			if (event.key === ".") {
				event.preventDefault();
				void copyLinks();
			} else if (event.key === "Backspace" && view.get() === "root") {
				event.preventDefault();
				askDelete();
			}
			return;
		}

		if (event.altKey) return;
		if (view.get() !== "root") return;
		if (search.get() !== "") return;

		const key = event.key.toLowerCase();
		if (key === "a") {
			event.preventDefault();
			go("assignee");
		} else if (key === "i") {
			event.preventDefault();
			assignToMe();
		} else if (key === "s") {
			event.preventDefault();
			go("status");
		} else if (key === "p") {
			event.preventDefault();
			go("priority");
		} else if (key === "l") {
			event.preventDefault();
			go("labels");
		} else if (key === "t") {
			event.preventDefault();
			go("team");
		} else if (key === "r" && hasRepositories.get()) {
			event.preventDefault();
			go("repository");
		}
	};

	return Div(
		{ class: "contents" },
		ImplementLifecycle({
			onMount: () => {
				const run = () => {
					if (selected.get().length === 0) return false;
					view.set("root");
					open.set(true);
					return true;
				};
				openBulkFromCommand = run;
				return () => {
					if (openBulkFromCommand === run) openBulkFromCommand = null;
				};
			},
		}),
		ImplementEffect([selected], (current) => {
			if (current.length === 0) {
				open.set(false);
				view.set("root");
			}
		}),
		ImplementEffect([open], (isOpen) => {
			if (focusFrame !== undefined) {
				cancelAnimationFrame(focusFrame);
				focusFrame = undefined;
			}
			if (isOpen) {
				search.set("");
				focusSearch();
				return;
			}
			view.set("root");
		}),
		ImplementDocument({
			onKeydown: (event) => {
				if (!open.get()) return;
				if (event.key !== "Escape") return;
				if (view.get() === "root") return;
				event.preventDefault();
				event.stopPropagation();
				go("root");
			},
		}),
		ResponsiveDialog(
			{ open },
			ResponsiveDialogContent(
				// No max-width override: the default keeps a phone's 1rem margins.
				{ class: "gap-0 overflow-hidden p-0", showCloseButton: false },
				DialogTitle({ class: "sr-only" }, "Bulk actions"),
				DialogDescription(
					{ class: "sr-only" },
					chosen.bind((list) =>
						list.length === 1
							? "Choose an action for the selected issue."
							: `Choose an action for ${list.length} selected issues.`,
					),
				),

				Div(
					{ class: "flex h-10 shrink-0 items-center gap-2 px-3" },
					If(
						view.bind((current) => current !== "root"),
						Div(
							{ class: "flex min-w-0 flex-1 items-center gap-1" },
							Button(
								{
									variant: "ghost",
									size: "icon-xs",
									class: "size-6",
									"aria-label": "Back",
									onClick: () => go("root"),
								},
								ChevronLeft({ class: "size-3.5" }),
							),
							Span(
								{ class: "truncate text-[13px] font-medium" },
								view.bind((current) => VIEW_TITLE[current]),
							),
						),
					),
					Span(
						{
							class:
								"inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-0.5 pl-2 text-[12px] text-muted-foreground",
						},
						chosen.bind((list) => (list.length === 1 ? "1 issue" : `${list.length} issues`)),
						Button(
							{
								variant: "ghost",
								size: "icon-xs",
								class: "size-5 rounded-full text-muted-foreground",
								"aria-label": "Close",
								onClick: () => open.set(false),
							},
							X({ class: "size-3" }),
						),
					),
				),

				Switch(view)
					.Case(
						"root",
						RootCommands(
							search,
							searchRef,
							onCommandKey,
							go,
							hasRepositories,
							assignToMe,
							() => {
								open.set(false);
								transferOpen.set(true);
							},
							() => void copyLinks(),
							askDelete,
						),
					)
					.Case("status", StatusCommands(search, searchRef, onCommandKey, setStatus))
					.Case("priority", PriorityCommands(search, searchRef, onCommandKey, setPriority))
					.Case("assignee", AssigneeCommands(search, searchRef, onCommandKey, members, setAssignee))
					.Case("labels", LabelCommands(search, searchRef, onCommandKey, labels, addLabel))
					.Case("team", TeamCommands(search, searchRef, onCommandKey, teams, setTeam))
					.Case(
						"repository",
						RepositoryCommands(search, searchRef, onCommandKey, repositories, setRepository),
					)
					.Exhaustive(),
			),
		),
		TransferIssueDialog({
			slug,
			targets,
			open: transferOpen,
			onTransferred: (moved) => {
				const done = new Set(moved.map((issue) => issue.id));
				issues.update((list) => list.filter((issue) => !done.has(issue.id)));
				selected.update((current) => current.filter((id) => !done.has(id)));
			},
		}),
		DeleteIssuesDialog({
			slug,
			issues,
			targets: selected,
			open: deleteOpen,
			// The rows are already out of `issues`; this is what keeps the pill
			// from going on counting things that are not there any more.
			onDeleted: (done) => {
				const gone = new Set(done);
				selected.update((current) => current.filter((id) => !gone.has(id)));
			},
		}),
	);
}

function RootCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	go: (view: BulkView) => void,
	hasRepositories: Readable<boolean>,
	assignToMe: () => void,
	transfer: () => void,
	copyLinks: () => void,
	askDelete: () => void,
) {
	return Command(
		{ label: "Bulk actions", search, class: "rounded-none" },
		CommandInput({
			this: searchRef,
			placeholder: "Type a command or search…",
			onKeydown,
			autofocus: true,
		}),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					CommandItem(
						{ value: "assign to", onSelect: () => go("assignee") },
						User({ class: "size-3.5" }),
						"Assign to…",
						Shortcut("A"),
					),
					CommandItem(
						{ value: "assign to me", onSelect: assignToMe },
						User({ class: "size-3.5" }),
						"Assign to me",
						Shortcut("I"),
					),
					CommandItem(
						{ value: "change status", onSelect: () => go("status") },
						StatusIcon("todo"),
						"Change status…",
						Shortcut("S"),
					),
					CommandItem(
						{ value: "set priority", onSelect: () => go("priority") },
						PriorityIcon("none"),
						"Set priority…",
						Shortcut("P"),
					),
					CommandItem(
						{ value: "add labels", onSelect: () => go("labels") },
						Tag({ class: "size-3.5" }),
						"Add labels…",
						Shortcut("L"),
					),
					CommandItem(
						{ value: "move to team", onSelect: () => go("team") },
						Users({ class: "size-3.5" }),
						"Move to team…",
						Shortcut("T"),
					),
					If(
						hasRepositories,
						CommandItem(
							{ value: "set repository scope", onSelect: () => go("repository") },
							FolderGit2({ class: "size-3.5" }),
							"Set repository…",
							Shortcut("R"),
						),
					),
					CommandItem(
						{ value: "transfer workspace", onSelect: transfer },
						ArrowRight({ class: "size-3.5" }),
						"Transfer to workspace…",
					),
				),
			),
			CommandSeparator(),
			CommandGroup(
				CommandGroupItems(
					CommandItem(
						{ value: "copy issue ids as links", onSelect: copyLinks },
						Link({ class: "size-3.5" }),
						"Copy issue IDs as links",
						Shortcut("⌘."),
					),
				),
			),
			CommandSeparator(),
			// On its own at the bottom, in the destructive colour, so it is never
			// the thing your hand lands on by accident.
			CommandGroup(
				CommandGroupItems(
					CommandItem(
						{
							value: "delete issues remove",
							class:
								"text-destructive data-selected:bg-destructive/10 data-selected:text-destructive",
							onSelect: askDelete,
						},
						Trash2({ class: "size-3.5" }),
						"Delete issues…",
						Shortcut("⌘⌫"),
					),
				),
			),
		),
	);
}

function StatusCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	onPick: (status: IssueStatus) => void,
) {
	return Command(
		{ label: "Change status", search, class: "rounded-none" },
		CommandInput({ this: searchRef, placeholder: "Change status…", onKeydown, autofocus: true }),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					...ISSUE_STATUSES.map((status) =>
						CommandItem(
							{ value: `${STATUS_LABELS[status]} ${status}`, onSelect: () => onPick(status) },
							StatusIcon(status),
							STATUS_LABELS[status],
						),
					),
				),
			),
		),
	);
}

function PriorityCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	onPick: (priority: IssuePriority) => void,
) {
	return Command(
		{ label: "Set priority", search, class: "rounded-none" },
		CommandInput({ this: searchRef, placeholder: "Set priority…", onKeydown, autofocus: true }),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					...ISSUE_PRIORITIES.map((priority) =>
						CommandItem(
							{
								value: `${PRIORITY_LABELS[priority]} ${priority}`,
								onSelect: () => onPick(priority),
							},
							PriorityIcon(priority),
							PRIORITY_LABELS[priority],
						),
					),
				),
			),
		),
	);
}

function AssigneeCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	members: Readable<Member[]>,
	onPick: (userId: string | null) => void,
) {
	return Command(
		{ label: "Assign to", search, class: "rounded-none" },
		CommandInput({ this: searchRef, placeholder: "Assign to…", onKeydown, autofocus: true }),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					CommandItem(
						{ value: "unassigned nobody", onSelect: () => onPick(null) },
						UnassignedAvatar("size-3.5"),
						"Unassigned",
					),
					ForEach(
						members,
						(member) => member.id,
						(member) =>
							CommandItem(
								{
									value: `${member.get().user.name} ${member.get().user.email}`,
									onSelect: () => onPick(member.get().user.id),
								},
								UserAvatar(member.get().user, "size-3.5 text-[8px]"),
								Span(
									{ class: "min-w-0 flex-1 truncate" },
									member.bind((value) => value.user.name),
								),
							),
					),
				),
			),
		),
	);
}

function LabelCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	labels: Readable<Label[]>,
	onPick: (labelId: string) => void,
) {
	return Command(
		{ label: "Add labels", search, class: "rounded-none" },
		CommandInput({ this: searchRef, placeholder: "Add labels…", onKeydown, autofocus: true }),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					ForEach(
						labels,
						(label) => label.id,
						(label) =>
							CommandItem(
								{
									value: label.get().name,
									onSelect: () => onPick(label.get().id),
								},
								Span({
									class: "size-2.5 shrink-0 rounded-full",
									style: { backgroundColor: label.get().color },
								}),
								Span({ class: "min-w-0 flex-1 truncate" }, label.bind("name")),
							),
					),
				),
			),
		),
	);
}

function TeamCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	teams: Readable<Team[]>,
	onPick: (key: string) => void,
) {
	return Command(
		{ label: "Move to team", search, class: "rounded-none" },
		CommandInput({ this: searchRef, placeholder: "Move to team…", onKeydown, autofocus: true }),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					ForEach(
						teams,
						(team) => team.id,
						(team) =>
							CommandItem(
								{
									value: `${team.get().key} ${team.get().name}`,
									onSelect: () => onPick(team.get().key),
								},
								Span(
									{ class: "w-10 shrink-0 font-mono text-[11px] text-muted-foreground" },
									team.bind("key"),
								),
								Span({ class: "min-w-0 flex-1 truncate" }, team.bind("name")),
							),
					),
				),
			),
		),
	);
}

function RepositoryCommands(
	search: Signal<string>,
	searchRef: Signal<HTMLInputElement | null>,
	onKeydown: (event: KeyboardEvent) => void,
	repositories: Readable<Repository[]>,
	onPick: (repositoryId: string | null) => void,
) {
	return Command(
		{ label: "Set repository", search, class: "rounded-none" },
		CommandInput({ this: searchRef, placeholder: "Set repository…", onKeydown, autofocus: true }),
		CommandList(
			{ class: "h-72" },
			CommandEmpty("Nothing matches."),
			CommandGroup(
				CommandGroupItems(
					CommandItem(
						{ value: "none no repository clear", onSelect: () => onPick(null) },
						FolderGit2({ class: "size-3.5 text-muted-foreground" }),
						Span({ class: "min-w-0 flex-1 truncate text-muted-foreground" }, "None"),
					),
					ForEach(
						repositories,
						(repo) => repo.id,
						(repo) =>
							CommandItem(
								{
									value: repo.get().fullName,
									onSelect: () => onPick(repo.get().id),
								},
								ProviderMark(repo.get().provider, "size-3.5 shrink-0 text-muted-foreground"),
								Span({ class: "min-w-0 flex-1 truncate" }, repo.bind("fullName")),
							),
					),
				),
			),
		),
	);
}

function Shortcut(keys: string) {
	return Span({ class: "ml-auto text-[11px] text-muted-foreground" }, keys);
}

function resolveAssignee(members: Member[], assigneeId: string | null): UserSummary | null {
	if (assigneeId === null) return null;
	return members.find((member) => member.user.id === assigneeId)?.user ?? null;
}

function applyLabel(
	labels: Label[],
	extra: Label | undefined,
	labelId: string,
	adding: boolean,
): Label[] {
	if (adding) {
		if (labels.some((label) => label.id === labelId) || extra === undefined) return labels;
		return [...labels, extra];
	}
	return labels.filter((label) => label.id !== labelId);
}

export function rowCheckboxClass(anySelected: Readable<boolean>): ClassValue {
	return cn(
		"size-3.5",
		anySelected.bind((on) =>
			on
				? "opacity-100"
				: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=checked]:opacity-100",
		),
	);
}
