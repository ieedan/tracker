/**
 * Labels on the details view, the way Linear does them.
 *
 * Every label is its own trigger: clicking the pill you want rid of opens the
 * menu with it already ticked, rather than making you find a separate control
 * first. A trailing button opens the same menu to add one, and is the whole
 * control — reading "Add label" — while the issue has none.
 */
import {
	Div,
	Dynamic,
	ForEach,
	Fragment,
	ImplementEffect,
	Span,
	signal,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Plus, Tag } from "@implementjs/lucide";
import { MenuCheckbox, applyIdDiff } from "@/lib/components/ui/menu-checkbox";
import {
	DropdownMenu,
	DropdownMenuCheckboxGroup,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroupHeading,
	DropdownMenuTrigger,
} from "@/lib/components/ui/dropdown-menu";
import type { Label } from "@/lib/domain/schemas";

const pillClass =
	"inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-transparent px-2 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground";

const addClass =
	"inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed border-border bg-transparent px-1.5 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground";

export interface IssueLabelPickerProps {
	selected: Readable<Label[]>;
	available: Readable<Label[]>;
	onToggle: (labelId: string) => void;
	/** The `L` shortcut opens the add button's copy of the menu. */
	open?: Signal<boolean>;
}

export function IssueLabelPicker({ selected, available, onToggle, open }: IssueLabelPickerProps) {
	/**
	 * The same menu, built fresh behind each trigger.
	 *
	 * The checked set has to be its own signal per copy: the checkbox group
	 * writes back into it, and copies sharing one would fight over it.
	 */
	const menu = (trigger: Child, controlled?: Signal<boolean>) => {
		const selectedIds = signal(selected.get().map((label) => label.id));

		return DropdownMenu(
			{ open: controlled },
			ImplementEffect([selected], (labels) => selectedIds.set(labels.map((label) => label.id))),
			trigger,
			DropdownMenuContent(
				{ class: "w-56", align: "start", search: "Add label…", hotkeys: true },
				DropdownMenuCheckboxGroup(
					{
						value: selectedIds,
						onValueChange: (ids) => {
							applyIdDiff(
								selected.get().map((label) => label.id),
								ids,
								onToggle,
							);
						},
					},
					DropdownMenuGroupHeading("Labels"),
					ForEach(
						available,
						(label) => label.id,
						(label) =>
							DropdownMenuCheckboxItem(
								{
									value: label.get().id,
									indicator: MenuCheckbox(selectedIds, label.get().id),
								},
								Span({
									class: "size-2.5 shrink-0 rounded-full",
									style: { backgroundColor: label.get().color },
								}),
								Span({ class: "flex-1 truncate" }, label.bind("name")),
							),
					),
				),
			),
		);
	};

	return Div(
		{ class: "flex flex-wrap items-center gap-1" },

		ForEach(
			selected,
			(label) => label.id,
			(label) =>
				menu(
					DropdownMenuTrigger(
						{
							variant: "ghost",
							size: "sm",
							class: pillClass,
							title: `${label.get().name} — click to change labels`,
						},
						Span({
							class: "size-2 shrink-0 rounded-full",
							style: { backgroundColor: label.get().color },
						}),
						Span({ class: "max-w-32 truncate" }, label.bind("name")),
					),
				),
		),

		// One trigger, two readings: the bare `+` once there is something to add
		// to, and a labelled button while the row would otherwise be empty.
		menu(
			DropdownMenuTrigger(
				{ variant: "ghost", size: "sm", class: addClass, title: "Labels (L)" },
				Dynamic([selected], (labels) =>
					labels.length === 0
						? Fragment(Tag({ class: "size-3" }), Span({}, "Add label"))
						: Plus({ class: "size-3" }),
				),
			),
			open,
		),
	);
}
