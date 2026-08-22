import {
	Div,
	ForEach,
	If,
	Span,
	derived,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { FolderGit2Icon, UserIcon } from "@implementjs/lucide";
import { PriorityIcon, ReactivePriorityIcon } from "@/lib/components/priority-icon";
import { ReactiveUserAvatar, UserAvatar } from "@/lib/components/issue-row";
import { ReactiveStatusIcon } from "@/lib/components/status-icon";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/lib/components/ui/select";
import {
	PRIORITIES,
	PRIORITY_LABELS,
	type Priority,
	type RepoDto,
	type StatusDto,
	type UserDto,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The property pickers shared by the issue sidebar and the new-issue dialog.
 *
 * They exist as one component rather than two copies because the trigger has
 * to render the selected option's glyph, not just its name — `SelectValue`
 * renders a plain label, so each of these supplies its own trigger content.
 */

const TRIGGER = "flex min-w-0 items-center gap-2 truncate";

export type PropertySelectProps = {
	/** The Select primitive drives this; null means nothing chosen. */
	value: Signal<string | null>;
	class?: string;
};

export function StatusSelect({
	value,
	statuses,
	class: className,
}: PropertySelectProps & { statuses: Readable<StatusDto[]> }) {
	const selected = derived(
		[value, statuses],
		(id, all) => all.find((status) => status.id === id) ?? null,
	);

	return Select(
		{ value },
		SelectTrigger(
			{ class: cn("h-8", className) },
			Div(
				{ class: TRIGGER },
				ReactiveStatusIcon(selected),
				Span(selected.bind((status) => status?.name ?? "Status")),
			),
		),
		SelectContent(
			ForEach(
				statuses,
				(status) => status.id,
				(status) =>
					SelectItem(
						// The label cannot be read off markup children, and without it
						// the trigger falls back to showing the raw id.
						{ value: status.get().id, label: status.get().name },
						Div(
							{ class: "flex items-center gap-2" },
							ReactiveStatusIcon(status),
							status.bind("name"),
						),
					),
			),
		),
	);
}

export function PrioritySelect({ value, class: className }: PropertySelectProps) {
	const selected = derived([value], (current) => (Number(current ?? 0) || 0) as Priority);

	return Select(
		{ value },
		SelectTrigger(
			{ class: cn("h-8", className) },
			Div(
				{ class: TRIGGER },
				ReactivePriorityIcon(selected),
				Span(selected.bind((priority) => PRIORITY_LABELS[priority])),
			),
		),
		SelectContent(
			...PRIORITIES.map((priority) =>
				SelectItem(
					{ value: String(priority), label: PRIORITY_LABELS[priority] },
					Div(
						{ class: "flex items-center gap-2" },
						PriorityIcon(priority),
						PRIORITY_LABELS[priority],
					),
				),
			),
		),
	);
}

/** `"none"` rather than null, so "No repo" is a real choice and not an empty trigger. */
export function RepoSelect({
	value,
	repos,
	class: className,
}: PropertySelectProps & { repos: Readable<RepoDto[]> }) {
	const selected = derived([value, repos], (id, all) => all.find((repo) => repo.id === id) ?? null);

	return Select(
		{ value },
		SelectTrigger(
			{ class: cn("h-8", className) },
			Div(
				{ class: TRIGGER },
				FolderGit2Icon({
					class: selected.bind((repo) =>
						cn("size-4 shrink-0", repo === null ? "opacity-40" : "opacity-70"),
					),
				}),
				Span(selected.bind((repo) => repo?.name ?? "No repo")),
			),
		),
		SelectContent(
			SelectItem(
				{ value: "none", label: "No repo" },
				Div(
					{ class: "flex items-center gap-2" },
					FolderGit2Icon({ class: "size-4 opacity-40" }),
					"No repo",
				),
			),
			ForEach(
				repos,
				(repo) => repo.id,
				(repo) =>
					SelectItem(
						{ value: repo.get().id, label: repo.get().name },
						Div(
							{ class: "flex items-center gap-2" },
							FolderGit2Icon({ class: "size-4 opacity-70" }),
							repo.bind("name"),
						),
					),
			),
		),
	);
}

/**
 * `"none"` rather than null, so "Unassigned" is a choice you can make rather
 * than the absence of one.
 *
 * The pool is whoever has appeared on an issue in this workspace — there is no
 * members table to draw from, since membership lives on GitHub.
 */
export function AssigneeSelect({
	value,
	members,
	class: className,
}: PropertySelectProps & { members: Readable<UserDto[]> }) {
	const selected = derived(
		[value, members],
		(id, all) => all.find((person) => person.id === id) ?? null,
	);

	return Select(
		{ value },
		SelectTrigger(
			{ class: cn("h-8", className) },
			Div(
				{ class: TRIGGER },
				If(selected.bind((person) => person === null))
					.Then(UserIcon({ class: "size-4 shrink-0 opacity-40" }))
					.Else(ReactiveUserAvatar(selected, "size-4")),
				Span(selected.bind((person) => person?.name ?? "Unassigned")),
			),
		),
		SelectContent(
			SelectItem(
				{ value: "none", label: "Unassigned" },
				Div(
					{ class: "flex items-center gap-2" },
					UserIcon({ class: "size-4 opacity-40" }),
					"Unassigned",
				),
			),
			ForEach(
				members,
				(person) => person.id,
				(person) =>
					SelectItem(
						{ value: person.get().id, label: person.get().name },
						Div(
							{ class: "flex items-center gap-2" },
							UserAvatar(person.get(), "size-4"),
							person.bind("name"),
						),
					),
			),
		),
	);
}
