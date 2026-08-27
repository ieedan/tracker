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
	Span,
	derived,
	type Child,
	type Readable,
	type Signal,
} from "@implementjs/core";
import { Plus, Tag } from "@implementjs/lucide";
import {
	ResponsiveMenu,
	type MenuOption,
	type MenuTriggerOptions,
} from "@/lib/components/ui/responsive-menu";
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
	const options = derived([available], (labels) =>
		labels.map((label): MenuOption => ({
			value: label.id,
			label: label.name,
			icon: () =>
				Span({
					class: "size-2.5 shrink-0 rounded-full",
					style: { backgroundColor: label.color },
				}),
		})),
	);
	const selectedIds = derived([selected], (labels) => labels.map((label) => label.id));

	/** The same menu, built fresh behind each trigger. */
	const menu = (trigger: MenuTriggerOptions, face: () => Child, controlled?: Signal<boolean>) =>
		ResponsiveMenu({
			heading: "Labels",
			search: "Add label…",
			multiple: true,
			open: controlled,
			options,
			selected: selectedIds,
			onSelect: onToggle,
			trigger,
			face,
		});

	return Div(
		{ class: "flex flex-wrap items-center gap-1" },

		ForEach(
			selected,
			(label) => label.id,
			(label) =>
				menu(
					{
						class: pillClass,
						title: `${label.get().name} — click to change labels`,
					},
					() =>
						Fragment(
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
			{ class: addClass, title: "Labels (L)" },
			() =>
				Dynamic([selected], (labels) =>
					labels.length === 0
						? Fragment(Tag({ class: "size-3" }), Span({}, "Add label"))
						: Plus({ class: "size-3" }),
				),
			open,
		),
	);
}
