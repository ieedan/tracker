/**
 * Which repository an issue is about.
 *
 * Rendered exactly like the other issue pickers so it reads as one more
 * property rather than a bolted-on integration, and hidden entirely when the
 * workspace has linked nothing — an empty dropdown is worse than no dropdown.
 */
import {
	Dynamic,
	ForEach,
	If,
	Span,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Check, FolderGit2 } from "@implementjs/lucide";
import { CHIP_GLYPH, GithubMark } from "@/lib/components/glyphs";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupHeading,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import type { GitProviderId } from "@/lib/domain/providers";
import type { Repository } from "@/lib/domain/schemas";
import { cn } from "@/lib/utils";

const triggerClass =
	"inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-[12px] text-muted-foreground hover:bg-accent";

export interface RepositoryRef {
	id: string;
	fullName: string;
	provider?: GitProviderId;
}

export function toRepositoryRef(
	repo: Pick<Repository, "id" | "fullName" | "provider">,
): RepositoryRef {
	return { id: repo.id, fullName: repo.fullName, provider: repo.provider };
}

export function RepositoryPicker(
	current: Readable<RepositoryRef | null>,
	repositories: Readable<Repository[]>,
	onPick: (repositoryId: string | null) => void,
	options: { showLabel?: boolean; class?: string; open?: Signal<boolean> } = {},
) {
	return If(
		repositories.bind((list) => list.length > 0),
		DropdownMenu(
			{ open: options.open },
			DropdownMenuTrigger(
				{
					variant: "ghost",
					size: "sm",
					class: cn(triggerClass, options.class),
					title: "Repository (R)",
				},
				RepositoryGlyph(current, repositories, CHIP_GLYPH.icon),
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
								ProviderMark(repo.get().provider, "size-3.5 shrink-0 text-muted-foreground"),
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
			Dynamic([repository], (value) => ProviderMark(value?.provider, "size-2.5")),
			repository.bind((value) =>
				value === null ? "" : (value.fullName.split("/")[1] ?? value.fullName),
			),
		),
	);
}

function RepositoryGlyph(
	current: Readable<RepositoryRef | null>,
	repositories: Readable<Repository[]>,
	className: string,
): Child {
	return Dynamic([current, repositories], (repo, list) => {
		const provider =
			repo?.provider ??
			(list.some((item) => item.provider === "github") ? "github" : list[0]?.provider);
		return ProviderMark(provider, className);
	});
}

function ProviderMark(provider: GitProviderId | undefined, className: string): Child {
	if (provider === "github") return GithubMark({ class: className });
	return FolderGit2({ class: className });
}

function Tick(shown: Readable<boolean>): Child {
	return If(shown, Check({ class: "size-3.5 shrink-0 text-primary" }));
}
