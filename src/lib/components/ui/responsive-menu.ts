/**
 * One picker, two shapes: the anchored dropdown it has always been where there
 * is a pointer, and a drawer up from the bottom edge where a thumb is what is
 * reaching for it (ENG-67).
 *
 * A property pill is about 24px tall and sits wherever the row it belongs to
 * put it, so on a phone the menu it opens is a panel anchored to something a
 * finger covers entirely — and one that runs off the side of the screen as
 * often as not. A drawer has none of those problems: it comes from an edge, it
 * is as wide as the device, and its rows are big enough to hit.
 *
 * The rows are described as data rather than built as nodes because the two
 * shapes draw them differently — a menu row carries `menuitemradio` semantics,
 * a hotkey hint and the type-to-filter the dropdown gets for free, while a
 * drawer row is a 44px button with a tick. Describing an option once is what
 * keeps the two shapes one list.
 *
 * @see responsive-dialog.ts, which does the same for a modal and lends this its
 * breakpoint.
 */
import {
	Div,
	Dynamic,
	ForEach,
	If,
	ImplementEffect,
	Span,
	mediaQuery,
	signal,
	type Child,
	type ClassValue,
	type Mountable,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Check } from "@implementjs/lucide";
import { Button } from "./button";
import type { ButtonSize, ButtonVariant } from "./button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";
import {
	DropdownMenu,
	DropdownMenuCheckboxGroup,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "./dropdown-menu";
import { MenuCheckbox, applyIdDiff } from "./menu-checkbox";
import { RESPONSIVE_DIALOG_QUERY } from "./responsive-dialog";
import { cn } from "@/lib/utils";

/** Below this a menu opens as a drawer. The dialog's breakpoint, so a picker inside one agrees with it. */
export const RESPONSIVE_MENU_QUERY = RESPONSIVE_DIALOG_QUERY;

/** One row of the menu, in the terms both shapes can draw. */
export interface MenuOption {
	/** What `onSelect` is handed, and what `selected` is matched against. */
	value: string;
	/** The row's words. */
	label: string;
	/**
	 * The glyph, swatch or avatar in front of the label. A factory because each
	 * shape builds its own copy — a node cannot be mounted in two places.
	 */
	icon?: () => Child;
	/** Trailing text after the label: a team's key, a repository's owner. */
	hint?: string;
	/** What the desktop filter matches on, when the label is not all of it. */
	search?: string;
	/** Drawn dimmed — the "None" row of an optional property. */
	muted?: boolean;
}

/** The pill itself: the button props both shapes put on their trigger. */
export interface MenuTriggerOptions {
	class?: ClassValue;
	title?: string;
	"aria-label"?: string;
	variant?: ButtonVariant;
	size?: ButtonSize;
}

export interface ResponsiveMenuOptions {
	/** The heading over the rows, and the drawer's title. */
	heading: string;
	/** The filter box's placeholder. Omitted, the dropdown has no filter box. */
	search?: string;
	options: Readable<MenuOption[]>;
	/**
	 * What is picked. A list either way, so one component covers both kinds:
	 * a single-select menu reads the first entry and ignores the rest.
	 */
	selected: Readable<string[]>;
	/** Toggling several rows (labels) rather than choosing one (status). */
	multiple?: boolean;
	onSelect: (value: string) => void;
	/** Driven from outside by the single-letter shortcuts. */
	open?: Signal<boolean>;
	/** The dropdown panel's width. Defaults to `w-56`. */
	contentClass?: ClassValue;
	trigger: MenuTriggerOptions;
	/** The trigger's contents. A factory, for the same reason `icon` is. */
	face: () => Child;
}

export function ResponsiveMenu(options: ResponsiveMenuOptions): Mountable {
	const open = options.open ?? signal(false);
	const isMobile = mediaQuery(RESPONSIVE_MENU_QUERY);

	// `Dynamic` rather than `If`, which would build both shapes for every
	// picker on the page — and a list row carries three of them.
	return Dynamic([isMobile], (mobile) =>
		mobile ? MenuDrawer(options, open) : MenuDropdown(options, open),
	);
}

/** What the filter matches a row on. */
function searchText(option: MenuOption): string | undefined {
	return option.search;
}

function Hint(option: Readable<MenuOption>): Child {
	return If(
		option.bind((value) => value.hint !== undefined),
		Span(
			{ class: "shrink-0 font-mono text-[11px] text-muted-foreground" },
			option.bind((value) => value.hint ?? ""),
		),
	);
}

/* -------------------------------------------------------------------------- */
/* The pointer shape                                                          */
/* -------------------------------------------------------------------------- */

function MenuDropdown(options: ResponsiveMenuOptions, open: Signal<boolean>): Mountable {
	const trigger = DropdownMenuTrigger(
		{
			variant: options.trigger.variant ?? "ghost",
			size: options.trigger.size ?? "sm",
			class: options.trigger.class,
			title: options.trigger.title,
			"aria-label": options.trigger["aria-label"],
		},
		options.face(),
	);

	const content = (...children: Child[]) =>
		DropdownMenuContent(
			{
				class: cn("w-56", options.contentClass),
				align: "start",
				search: options.search,
				hotkeys: true,
			},
			...children,
		);

	if (options.multiple === true) {
		// The checked set is this menu's own signal: the group writes back into
		// it, and the caller only ever hands out what is currently selected.
		const checked = signal(options.selected.get());

		return DropdownMenu(
			{ open },
			ImplementEffect([options.selected], (values) => checked.set(values)),
			trigger,
			content(
				DropdownMenuCheckboxGroup(
					{
						value: checked,
						onValueChange: (values) =>
							applyIdDiff(options.selected.get(), values, options.onSelect),
					},
					DropdownMenuGroupHeading(options.heading),
					ForEach(
						options.options,
						(option) => option.value,
						(option) =>
							DropdownMenuCheckboxItem(
								{
									value: option.get().value,
									label: searchText(option.get()),
									indicator: MenuCheckbox(checked, option.get().value),
								},
								option.get().icon?.() ?? null,
								Span({ class: "flex-1 truncate" }, option.bind("label")),
								Hint(option),
							),
					),
				),
			),
		);
	}

	const picked = signal<string | null>(options.selected.get()[0] ?? null);

	return DropdownMenu(
		{ open },
		ImplementEffect([options.selected], (values) => picked.set(values[0] ?? null)),
		trigger,
		content(
			DropdownMenuRadioGroup(
				{
					value: picked,
					onValueChange: (value) => {
						if (typeof value === "string") options.onSelect(value);
					},
				},
				DropdownMenuGroupHeading(options.heading),
				ForEach(
					options.options,
					(option) => option.value,
					(option) =>
						DropdownMenuRadioItem(
							{ value: option.get().value, label: searchText(option.get()) },
							option.get().icon?.() ?? null,
							Span(
								{
									class: cn("flex-1 truncate", {
										"text-muted-foreground": option.get().muted === true,
									}),
								},
								option.bind("label"),
							),
							Hint(option),
						),
				),
			),
		),
	);
}

/* -------------------------------------------------------------------------- */
/* The thumb shape                                                            */
/* -------------------------------------------------------------------------- */

/**
 * No filter box in here, deliberately: focusing one raises the on-screen
 * keyboard over the panel it is meant to be filtering, and the lists a picker
 * offers are short enough to scroll. The drawer that does need one — the filter
 * bar's — keeps the keyboard down by hand.
 */
function MenuDrawer(options: ResponsiveMenuOptions, open: Signal<boolean>): Mountable {
	return Div(
		{ class: "contents" },
		Button(
			{
				type: "button",
				variant: options.trigger.variant ?? "ghost",
				size: options.trigger.size ?? "sm",
				class: options.trigger.class,
				title: options.trigger.title,
				"aria-label": options.trigger["aria-label"],
				"aria-haspopup": "dialog",
				onClick: () => open.set(true),
			},
			options.face(),
		),
		Drawer(
			{ open },
			DrawerContent(
				DrawerTitle(
					{ class: "px-4 pt-1 pb-2 text-[13px] font-medium text-muted-foreground" },
					options.heading,
				),
				DrawerDescription({ class: "sr-only" }, `Pick from ${options.heading.toLowerCase()}.`),
				Div(
					{
						role: "menu",
						class: "flex max-h-[60dvh] flex-col gap-0.5 overflow-y-auto px-2 pb-2",
					},
					ForEach(
						options.options,
						(option) => option.value,
						(option) => DrawerRow(options, option, open),
					),
				),
			),
		),
	);
}

function DrawerRow(
	menu: ResponsiveMenuOptions,
	option: Readable<MenuOption>,
	open: Signal<boolean>,
): Mountable {
	const value = option.get().value;
	const checked = menu.selected.bind((values) => values.includes(value));

	return Button(
		{
			type: "button",
			variant: "ghost",
			role: menu.multiple === true ? "menuitemcheckbox" : "menuitemradio",
			"aria-checked": checked,
			class: "h-11 w-full justify-start gap-2.5 px-3 text-[14px] font-normal",
			onClick: () => {
				menu.onSelect(value);
				// Picking one is the whole errand; toggling labels is not, so a
				// multi-select drawer stays up for the next tap.
				if (menu.multiple !== true) open.set(false);
			},
		},
		option.get().icon?.() ?? null,
		Span(
			{
				class: cn("flex-1 truncate text-left", {
					"text-muted-foreground": option.get().muted === true,
				}),
			},
			option.bind("label"),
		),
		Hint(option),
		If(checked, Check({ class: "size-4 shrink-0 text-primary" })),
	);
}
