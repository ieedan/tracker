import { Div, ForEach, If, Span, type Child, type ComponentProps } from "@implementjs/core";
import { CheckIcon, ChevronDownIcon, XIcon } from "@implementjs/lucide";
import {
	Select as SelectPrimitive,
	SelectContent as SelectContentPrimitive,
	SelectGroup as SelectGroupPrimitive,
	SelectGroupHeading as SelectGroupHeadingPrimitive,
	SelectItem as SelectItemPrimitive,
	SelectTrigger as SelectTriggerPrimitive,
	SelectValue as SelectValuePrimitive,
} from "@implementjs/primitives";
import { menuGroupHeadingClasses } from "./dropdown-menu";
import { cn } from "../../utils";
import { createComponent } from "@implementjs/primitives";

export type SelectProps = ComponentProps<typeof SelectPrimitive>;
export type SelectTriggerProps = ComponentProps<typeof SelectTriggerPrimitive>;
export type SelectContentProps = ComponentProps<typeof SelectContentPrimitive>;
export type SelectItemProps = ComponentProps<typeof SelectItemPrimitive>;
export type SelectGroupProps = ComponentProps<typeof SelectGroupPrimitive>;
export const SelectGroup = SelectGroupPrimitive;
export type SelectGroupHeadingProps = ComponentProps<typeof SelectGroupHeadingPrimitive>;

export type SelectValueProps = {
	placeholder?: string;
};

export const SelectValue = createComponent(function SelectValue({
	placeholder = "",
}: SelectValueProps) {
	return SelectValuePrimitive({
		render: (props) => {
			if (props.type === "single") {
				return Span(
					{ "data-slot": "select-value", class: "truncate" },
					If(props.selected.bind((selected) => selected === null))
						.Then(Span({ class: "text-muted-foreground" }, placeholder))
						.Else(props.selected.bind((selected) => selected?.label ?? "")),
				);
			}

			const values = props.value;

			function removeValue(event: Event, id: string) {
				event.preventDefault();
				event.stopPropagation();
				const index = values.get().indexOf(id);
				if (index !== -1) values.splice(index, 1);
			}

			return Div(
				{
					"data-slot": "select-value",
					class:
						"flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
				},
				If(props.selected.bind((selected) => selected.length === 0)).Then(
					Span({ class: "text-muted-foreground" }, placeholder),
				),
				ForEach(
					props.selected,
					(item) => item.value,
					(item) =>
						Span(
							{
								class:
									"inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium",
							},
							Span(
								{ class: "truncate" },
								item.bind((current) => current.label),
							),
							Span(
								{
									role: "button",
									tabIndex: -1,
									"aria-label": item.bind((current) => `Remove ${current.label}`),
									class:
										"flex size-3.5 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/10",
									onPointerdown: (event) => event.stopPropagation(),
									onClick: (event) => removeValue(event, item.get().value),
								},
								XIcon({ class: "size-3", "aria-hidden": true }),
							),
						),
				),
			);
		},
	});
});

export const Select = createComponent(function Select(props: SelectProps, ...children: Child[]) {
	return SelectPrimitive(props, Div({ class: "relative" }, ...children));
});

export const SelectTrigger = createComponent(function SelectTrigger(
	{ class: className, type = "button", noIcon = false, ...props }: SelectTriggerProps & { noIcon?: boolean },
	...children: Child[]
) {
	return SelectTriggerPrimitive(
		{
			type,
			...props,
			"data-slot": "select-trigger",
			class: cn(
				"flex min-h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			),
		},
		...children,
		noIcon ? null : ChevronDownIcon({
			"aria-hidden": true,
			class: "size-4 shrink-0 opacity-50",
		}),
	);
});

export const SelectContent = createComponent(function SelectContent(
	{ offset = 4, side = "bottom", align = "start", class: className, ...props }: SelectContentProps,
	...children: Child[]
) {
	return SelectContentPrimitive(
		{
			...props,
			offset,
			side,
			align,
			"data-slot": "select-content",
			class: cn(
				"absolute z-50 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
				"min-w-32 origin-(--ip-select-content-transform-origin)",
				"max-h-(--ip-select-content-available-height)",
				"transition-[opacity,translate,scale,display] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
				"data-[state=open]:block data-[state=open]:translate-0 data-[state=open]:scale-100 data-[state=open]:opacity-100",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:scale-95 data-[state=closed]:opacity-0",
				"data-[state=closed]:data-[side=bottom]:-translate-y-2 data-[state=closed]:data-[side=top]:translate-y-2 data-[state=closed]:data-[side=left]:translate-x-2 data-[state=closed]:data-[side=right]:-translate-x-2",
				"starting:data-[state=open]:opacity-0 starting:data-[state=open]:scale-95",
				"starting:data-[state=open]:data-[side=bottom]:-translate-y-2 starting:data-[state=open]:data-[side=top]:translate-y-2 starting:data-[state=open]:data-[side=left]:translate-x-2 starting:data-[state=open]:data-[side=right]:-translate-x-2",
				className,
			),
		},
		...children,
	);
});

export const SelectItem = createComponent(function SelectItem(
	{ class: className, ...props }: SelectItemProps,
	...children: Child[]
) {
	return SelectItemPrimitive(
		{
			...props,
			"data-slot": "select-item",
			class: cn(
				"group/select-item relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none",
				"data-selected:bg-accent/50",
				"data-highlighted:bg-accent data-highlighted:text-accent-foreground",
				"data-selected:data-highlighted:bg-accent",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			),
		},
		...children,
		Span(
			{
				class: "absolute right-2 flex size-3.5 items-center justify-center",
			},
			CheckIcon({
				"aria-hidden": true,
				class: "size-4 opacity-0 group-data-selected/select-item:opacity-100",
			}),
		),
	);
});

export const SelectGroupHeading = createComponent(function SelectGroupHeading(
	{ class: className, ...props }: SelectGroupHeadingProps,
	...children: Child[]
) {
	return SelectGroupHeadingPrimitive(
		{
			...props,
			"data-slot": "select-group-heading",
			class: cn(menuGroupHeadingClasses, className),
		},
		...children,
	);
});
