/**
 * Choose a team's tile — the glyph and the color behind it.
 *
 * The trigger *is* the tile, so what you click is what you are editing, and the
 * panel below it is a palette row over a grid of glyphs. A Popover rather than a
 * dropdown menu: this is a grid of swatches, not a list of rows, and menu
 * semantics (roving focus, type-ahead, one choice closes it) fight that. Both
 * halves stay open while you try combinations.
 *
 * Nothing here writes to the server. It drives the two signals it is handed and
 * calls `onChange`, so a create form can hold the choice until submit while a
 * settings row can PATCH on every pick.
 */
import { Div, Dynamic, Span, signal, type Readable, type Signal } from "@implementjs/core";
import { Button } from "@/lib/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/components/ui/popover";
import { TEAM_ICON_NAMES, type TeamIconName } from "@/lib/domain/team-icons";
import { cn } from "@/lib/utils";
import { TEAM_COLORS, TEAM_ICONS, TeamIcon } from "./team-icon";

export interface TeamLookPickerOptions {
	/** Drives the hashed fallback look while no icon is chosen. */
	name: Readable<string>;
	/** Lets a well-known key (`ENG`, `PRD`) preview its curated default look. */
	teamKey?: Readable<string>;
	icon: Signal<string | null>;
	color: Signal<string | null>;
	/** Called after either half changes, with both values as they now stand. */
	onChange?: (look: { icon: string | null; color: string | null }) => void;
	/** Tile size on the trigger. */
	class?: string;
	disabled?: boolean;
}

export function TeamLookPicker({
	name,
	teamKey,
	icon,
	color,
	onChange,
	class: className,
	disabled = false,
}: TeamLookPickerOptions) {
	const open = signal(false);

	const commit = () => onChange?.({ icon: icon.get(), color: color.get() });

	const pickIcon = (next: TeamIconName | null) => {
		icon.set(icon.get() === next ? null : next);
		commit();
	};

	const pickColor = (next: string) => {
		color.set(next);
		commit();
	};

	return Popover(
		{ open },
		PopoverTrigger(
			{
				variant: "ghost",
				size: "icon-sm",
				class: cn("shrink-0 p-0 hover:bg-accent/60", className),
				disabled,
				title: "Change this team's icon",
			},
			// Rebuilt whenever the choice changes — the glyph is a real node, so it
			// cannot simply be bound to.
			Dynamic([name, teamKey ?? name, icon, color], (value, keyValue, glyph, tint) =>
				TeamIcon(
					{
						name: value,
						key: teamKey === undefined ? undefined : keyValue,
						icon: glyph,
						color: tint,
					},
					"size-5",
				),
			),
		),
		PopoverContent(
			{ class: "w-64 p-2.5", align: "start" },

			Div(
				{ class: "flex flex-col gap-2" },
				Span({ class: "text-[11px] font-medium text-muted-foreground" }, "Color"),
				Div(
					{ class: "flex flex-wrap items-center gap-1.5" },
					...TEAM_COLORS.map((swatch) =>
						Div({
							class: color.bind((current) =>
								cn(
									"size-5 cursor-pointer rounded-full",
									current === swatch && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
								),
							),
							style: { backgroundColor: swatch },
							title: swatch,
							onClick: () => pickColor(swatch),
						}),
					),
				),
			),

			Div(
				{ class: "mt-3 flex flex-col gap-2" },
				Div(
					{ class: "flex items-center justify-between" },
					Span({ class: "text-[11px] font-medium text-muted-foreground" }, "Icon"),
					Button(
						{
							variant: "ghost",
							size: "xs",
							class: "h-5 px-1.5 text-[11px] text-muted-foreground",
							onClick: () => pickIcon(null),
						},
						"Use default",
					),
				),
				// A grid rather than a list: thirty glyphs read as a palette you scan,
				// and eight to a row keeps the panel the width of the popover.
				Div(
					{ class: "grid grid-cols-8 gap-1" },
					...TEAM_ICON_NAMES.map((value) =>
						Button(
							{
								variant: "ghost",
								size: "icon-xs",
								class: icon.bind((current) =>
									cn(
										"text-muted-foreground hover:text-foreground",
										current === value && "bg-accent text-foreground",
									),
								),
								title: value,
								onClick: () => pickIcon(value),
							},
							TEAM_ICONS[value]({ class: "size-3.5" }),
						),
					),
				),
			),
		),
	);
}
