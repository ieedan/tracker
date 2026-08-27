import { Div, type Child, type ComponentProps } from "@implementjs/core";
import { SearchIcon } from "@implementjs/lucide";
import {
	Command as CommandPrimitive,
	CommandEmpty as CommandEmptyPrimitive,
	CommandGroup as CommandGroupPrimitive,
	CommandGroupHeading as CommandGroupHeadingPrimitive,
	CommandGroupItems as CommandGroupItemsPrimitive,
	CommandInput as CommandInputPrimitive,
	CommandItem as CommandItemPrimitive,
	CommandLinkItem as CommandLinkItemPrimitive,
	CommandList as CommandListPrimitive,
	CommandLoading as CommandLoadingPrimitive,
	CommandSeparator as CommandSeparatorPrimitive,
	CommandViewport as CommandViewportPrimitive,
	computeCommandScore,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

/**
 * Ranking, with exact matches pinned to the top.
 *
 * The primitive's default score is a fuzzy one, and fuzzy has no opinion about
 * `ENG-1` versus `ENG-12`: every `ENG-1…` identifier opens with the characters
 * you typed, so they all score alike and the one you actually named lands
 * wherever the list happened to put it. When what you typed *is* one of an
 * item's words, that item is the one you meant — so it is scored into a band
 * above every partial match rather than shuffled in among them.
 */
export function exactFirstScore(value: string, search: string, keywords?: string[]): number {
	const base = computeCommandScore(value, search, keywords);
	if (base === 0) return 0;

	const needle = search.trim().toLowerCase();
	if (needle === "") return base;

	const haystack = value.trim().toLowerCase();
	if (haystack === needle) return 1;

	// Words rather than characters: `ENG-1` is a word of "ENG-1 No way to re-run
	// a load after a mutation", and `ENG-12` is not.
	const matchesWord =
		haystack.split(/\s+/).includes(needle) ||
		keywords?.some((keyword) => keyword.trim().toLowerCase() === needle) === true;
	if (matchesWord) return 0.99;

	// Everything else keeps the order the fuzzy score gave it, under the band.
	return base * 0.98;
}

export type CommandProps = ComponentProps<typeof CommandPrimitive>;
export type CommandInputProps = ComponentProps<typeof CommandInputPrimitive>;
export type CommandListProps = ComponentProps<typeof CommandListPrimitive>;
export type CommandViewportProps = ComponentProps<typeof CommandViewportPrimitive>;
export type CommandEmptyProps = ComponentProps<typeof CommandEmptyPrimitive>;
export type CommandLoadingProps = ComponentProps<typeof CommandLoadingPrimitive>;
export type CommandGroupProps = ComponentProps<typeof CommandGroupPrimitive>;
export type CommandGroupHeadingProps = ComponentProps<typeof CommandGroupHeadingPrimitive>;
export type CommandGroupItemsProps = ComponentProps<typeof CommandGroupItemsPrimitive>;
export type CommandItemProps = ComponentProps<typeof CommandItemPrimitive>;
export type CommandLinkItemProps = ComponentProps<typeof CommandLinkItemPrimitive>;
export type CommandSeparatorProps = ComponentProps<typeof CommandSeparatorPrimitive>;

export const Command = createComponent(function Command(
	{ class: className, filter = exactFirstScore, ...props }: CommandProps,
	...children: Child[]
) {
	return CommandPrimitive(
		{
			filter,
			...props,
			"data-slot": "command",
			class: cn(
				"flex size-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
				className,
			),
		},
		...children,
	);
});

export const CommandInput = createComponent(function CommandInput({
	class: className,
	...props
}: CommandInputProps) {
	return Div(
		{ "data-slot": "command-input-wrapper", class: "flex h-11 items-center gap-2 border-b px-3" },
		SearchIcon({ class: "size-4 shrink-0 text-muted-foreground", "aria-hidden": true }),
		CommandInputPrimitive({
			placeholder: "Type to search...",
			...props,
			"data-slot": "command-input",
			class: cn(
				// 16px below the breakpoint like `input` and `textarea`: Safari on iOS
				// zooms the page in on a focused field with smaller text than that
				"flex h-11 w-full bg-transparent py-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
				className,
			),
		}),
	);
});

export const CommandList = createComponent(function CommandList(
	{ class: className, ...props }: CommandListProps,
	...children: Child[]
) {
	return CommandListPrimitive(
		{
			...props,
			"data-slot": "command-list",
			class: cn("max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto", className),
		},
		...children,
	);
});

export const CommandViewport = createComponent(function CommandViewport(
	{ class: className, ...props }: CommandViewportProps,
	...children: Child[]
) {
	return CommandViewportPrimitive(
		{ ...props, "data-slot": "command-viewport", class: cn(className) },
		...children,
	);
});

export const CommandEmpty = createComponent(function CommandEmpty(
	{ class: className, ...props }: CommandEmptyProps,
	...children: Child[]
) {
	return CommandEmptyPrimitive(
		{
			...props,
			"data-slot": "command-empty",
			class: cn("py-6 text-center text-sm text-muted-foreground", className),
		},
		...children,
	);
});

export const CommandLoading = createComponent(function CommandLoading(
	{ class: className, ...props }: CommandLoadingProps,
	...children: Child[]
) {
	return CommandLoadingPrimitive(
		{
			...props,
			"data-slot": "command-loading",
			class: cn("py-6 text-center text-sm text-muted-foreground", className),
		},
		...children,
	);
});

export const CommandGroup = createComponent(function CommandGroup(
	{ class: className, ...props }: CommandGroupProps,
	...children: Child[]
) {
	return CommandGroupPrimitive(
		{ ...props, "data-slot": "command-group", class: cn("overflow-hidden", className) },
		...children,
	);
});

export const CommandGroupHeading = createComponent(function CommandGroupHeading(
	{ class: className, ...props }: CommandGroupHeadingProps,
	...children: Child[]
) {
	return CommandGroupHeadingPrimitive(
		{
			...props,
			"data-slot": "command-group-heading",
			class: cn("px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground uppercase", className),
		},
		...children,
	);
});

export const CommandGroupItems = createComponent(function CommandGroupItems(
	{ class: className, ...props }: CommandGroupItemsProps,
	...children: Child[]
) {
	return CommandGroupItemsPrimitive(
		{ ...props, "data-slot": "command-group-items", class: cn("p-1", className) },
		...children,
	);
});

const itemClass =
	"group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-selected:bg-accent data-selected:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export const CommandItem = createComponent(function CommandItem(
	{ class: className, ...props }: CommandItemProps,
	...children: Child[]
) {
	return CommandItemPrimitive(
		{ ...props, "data-slot": "command-item", class: cn(itemClass, className) },
		...children,
	);
});

export const CommandLinkItem = createComponent(function CommandLinkItem(
	{ class: className, ...props }: CommandLinkItemProps,
	...children: Child[]
) {
	return CommandLinkItemPrimitive(
		{ ...props, "data-slot": "command-link-item", class: cn(itemClass, className) },
		...children,
	);
});

export const CommandSeparator = createComponent(function CommandSeparator(
	{ class: className, ...props }: CommandSeparatorProps,
	...children: Child[]
) {
	return CommandSeparatorPrimitive(
		{ ...props, "data-slot": "command-separator", class: cn("h-px bg-border", className) },
		...children,
	);
});
