/**
 * Which repository an issue is about.
 *
 * Rendered exactly like the other issue pickers so it reads as one more
 * property rather than a bolted-on integration, and hidden entirely when the
 * workspace has linked nothing — an empty dropdown is worse than no dropdown.
 */
import { ForEach, If, Span, type Child, type Readable } from "@implementjs/core";
import { Check, FolderGit2 } from "@implementjs/lucide";
import { CHIP_GLYPH } from "@/lib/components/glyphs";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import type { Repository } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

export interface RepositoryRef {
	id: string;
	fullName: string;
}

export function RepositoryPicker(
	current: Readable<RepositoryRef | null>,
	repositories: Readable<Repository[]>,
	onPick: (repositoryId: string | null) => void,
	options: { showLabel?: boolean; class?: string } = {},
) {
	return If(
		repositories.bind((list) => list.length > 0),
		DropdownMenu(
			DropdownMenuTrigger(
				{
					variant: "ghost",
					size: "sm",
					class: cn(triggerClass, options.class),
					title: "Repository",
				},
				FolderGit2({ class: CHIP_GLYPH.icon }),
				Span(
					{},
					current.bind((repo) =>
						repo === null ? "Repository" : (repo.fullName.split("/")[1] ?? repo.fullName),
					),
				),
			),
			DropdownMenuContent(
				{ class: "w-64", align: "start" },
				DropdownMenuGroup(
					DropdownMenuGroupHeading("Repository"),
					DropdownMenuItem(
						{ onSelect: () => onPick(null) },
						Span({ class: "flex-1 text-muted-foreground" }, "None"),
						Tick(current.bind((repo) => repo === null)),
					),
					ForEach(
						repositories,
						(repo) => repo.id,
						(repo) =>
							DropdownMenuItem(
								{ onSelect: () => onPick(repo.get().id) },
								Span({ class: "flex-1 truncate" }, repo.bind("fullName")),
								Tick(current.bind((value) => value?.id === repo.get().id)),
							),
					),
				),
			),
		),
	);
}

/** The small badge on an issue row, when the list spans repositories. */
export function RepositoryBadge(repository: Readable<RepositoryRef | null>) {
	return If(
		repository.bind((value) => value !== null),
		Span(
			{
				class:
					"inline-flex shrink-0 items-center gap-1 rounded border border-border px-1 text-[10px] text-muted-foreground",
				title: repository.get()?.fullName,
			},
			FolderGit2({ class: "size-2.5" }),
			repository.bind((value) =>
				value === null ? "" : (value.fullName.split("/")[1] ?? value.fullName),
			),
		),
	);
}

function Tick(shown: Readable<boolean>): Child {
	return If(shown, Check({ class: "size-3.5 shrink-0 text-primary" }));
}
