import { Span, type Child, type ComponentProps } from "@implementjs/core";
import { CheckIcon, ChevronRightIcon } from "@implementjs/lucide";
import {
	Menubar as MenubarPrimitive,
	MenubarCheckboxGroup as MenubarCheckboxGroupPrimitive,
	MenubarCheckboxItem as MenubarCheckboxItemPrimitive,
	MenubarContent as MenubarContentPrimitive,
	MenubarGroup as MenubarGroupPrimitive,
	MenubarGroupHeading as MenubarGroupHeadingPrimitive,
	MenubarItem as MenubarItemPrimitive,
	MenubarMenu as MenubarMenuPrimitive,
	MenubarRadioGroup as MenubarRadioGroupPrimitive,
	MenubarRadioItem as MenubarRadioItemPrimitive,
	MenubarSeparator as MenubarSeparatorPrimitive,
	MenubarSub as MenubarSubPrimitive,
	MenubarSubContent as MenubarSubContentPrimitive,
	MenubarSubTrigger as MenubarSubTriggerPrimitive,
	MenubarTrigger as MenubarTriggerPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type MenubarProps = ComponentProps<typeof MenubarPrimitive>;

export const Menubar = createComponent(function Menubar(
	{ class: className, ...props }: MenubarProps,
	...children: Child[]
) {
	return MenubarPrimitive(
		{
			...props,
			"data-slot": "menubar",
			class: cn(
				"flex h-9 items-center gap-1 rounded-md border bg-background p-1 shadow-xs",
				className,
			),
		},
		...children,
	);
});

export type MenubarMenuProps = ComponentProps<typeof MenubarMenuPrimitive>;
export const MenubarMenu = MenubarMenuPrimitive;

export type MenubarTriggerProps = ComponentProps<typeof MenubarTriggerPrimitive>;

export const MenubarTrigger = createComponent(function MenubarTrigger(
	{ class: className, ...props }: MenubarTriggerProps,
	...children: Child[]
) {
	return MenubarTriggerPrimitive(
		{
			...props,
			"data-slot": "menubar-trigger",
			class: cn(
				"flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-none select-none",
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
				"data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
				className,
			),
		},
		...children,
	);
});

export type MenubarContentProps = ComponentProps<typeof MenubarContentPrimitive>;

export const MenubarContent = createComponent(function MenubarContent(
	{ class: className, offset = 8, ...props }: MenubarContentProps,
	...children: Child[]
) {
	return MenubarContentPrimitive(
		{
			offset,
			...props,
			"data-slot": "menubar-content",
			// no overflow clipping: sub-content panels render nested inside and extend past this box
			class: cn(
				"absolute z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
				"origin-(--ip-menubar-content-transform-origin)",
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

export type MenubarItemProps = ComponentProps<typeof MenubarItemPrimitive>;

export const MenubarItem = createComponent(function MenubarItem(
	{ class: className, ...props }: MenubarItemProps,
	...children: Child[]
) {
	return MenubarItemPrimitive(
		{
			...props,
			"data-slot": "menubar-item",
			class: cn(
				"relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none",
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			),
		},
		...children,
	);
});

export type MenubarCheckboxGroupProps = ComponentProps<typeof MenubarCheckboxGroupPrimitive>;
export const MenubarCheckboxGroup = MenubarCheckboxGroupPrimitive;

export type MenubarCheckboxItemProps = ComponentProps<typeof MenubarCheckboxItemPrimitive> & {
	/**
	 * The checked indicator, drawn in place of the default check. The left
	 * padding the default one is absolutely positioned into comes off with it:
	 * a custom indicator sits in the row's flow, so placing it is yours.
	 */
	indicator?: Child;
};

export const MenubarCheckboxItem = createComponent(function MenubarCheckboxItem(
	{ class: className, indicator, ...props }: MenubarCheckboxItemProps,
	...children: Child[]
) {
	return MenubarCheckboxItemPrimitive(
		{
			...props,
			"data-slot": "menubar-checkbox-item",
			class: cn(
				"group/menu-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none",
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				// room in the gutter for the default check, which is positioned into it
				indicator === undefined && "py-1.5 pr-2 pl-8",
				className,
			),
		},
		indicator ??
			Span(
				{
					"data-slot": "menu-item-indicator",
					class: "pointer-events-none absolute left-2 flex size-3.5 items-center justify-center",
				},
				CheckIcon({
					"aria-hidden": true,
					class: "size-4 hidden group-data-[state=checked]/menu-item:block",
				}),
			),
		...children,
	);
});

export type MenubarRadioGroupProps = ComponentProps<typeof MenubarRadioGroupPrimitive>;
export const MenubarRadioGroup = MenubarRadioGroupPrimitive;

export type MenubarRadioItemProps = ComponentProps<typeof MenubarRadioItemPrimitive>;

export const MenubarRadioItem = createComponent(function MenubarRadioItem(
	{ class: className, ...props }: MenubarRadioItemProps,
	...children: Child[]
) {
	return MenubarRadioItemPrimitive(
		{
			...props,
			"data-slot": "menubar-radio-item",
			class: cn(
				"group/menu-item relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none",
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			),
		},
		Span(
			{
				"data-slot": "menu-item-indicator",
				class: "pointer-events-none absolute left-2 flex size-3.5 items-center justify-center",
			},
			CheckIcon({
				"aria-hidden": true,
				class: "size-4 hidden group-data-[state=checked]/menu-item:block",
			}),
		),
		...children,
	);
});

export type MenubarGroupProps = ComponentProps<typeof MenubarGroupPrimitive>;
export const MenubarGroup = MenubarGroupPrimitive;

export type MenubarGroupHeadingProps = ComponentProps<typeof MenubarGroupHeadingPrimitive>;

export const MenubarGroupHeading = createComponent(function MenubarGroupHeading(
	{ class: className, ...props }: MenubarGroupHeadingProps,
	...children: Child[]
) {
	return MenubarGroupHeadingPrimitive(
		{
			...props,
			"data-slot": "menubar-group-heading",
			class: cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className),
		},
		...children,
	);
});

export type MenubarSeparatorProps = ComponentProps<typeof MenubarSeparatorPrimitive>;

export const MenubarSeparator = createComponent(function MenubarSeparator({
	class: className,
	...props
}: MenubarSeparatorProps) {
	return MenubarSeparatorPrimitive({
		...props,
		"data-slot": "menubar-separator",
		class: cn("-mx-1 my-1 h-px bg-border", className),
	});
});

export type MenubarSubProps = ComponentProps<typeof MenubarSubPrimitive>;
export const MenubarSub = MenubarSubPrimitive;

export type MenubarSubTriggerProps = ComponentProps<typeof MenubarSubTriggerPrimitive>;

export const MenubarSubTrigger = createComponent(function MenubarSubTrigger(
	{ class: className, ...props }: MenubarSubTriggerProps,
	...children: Child[]
) {
	return MenubarSubTriggerPrimitive(
		{
			...props,
			"data-slot": "menubar-sub-trigger",
			class: cn(
				"relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none",
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
				"data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
				"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			),
		},
		...children,
		ChevronRightIcon({ "aria-hidden": true, class: "ml-auto size-4" }),
	);
});

export type MenubarSubContentProps = ComponentProps<typeof MenubarSubContentPrimitive>;

export const MenubarSubContent = createComponent(function MenubarSubContent(
	{ class: className, offset = 8, ...props }: MenubarSubContentProps,
	...children: Child[]
) {
	return MenubarSubContentPrimitive(
		{
			offset,
			...props,
			"data-slot": "menubar-sub-content",
			// submenus pop in without a transition, so they feel instant
			class: cn(
				"absolute z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
				"data-[state=open]:block",
				"data-[state=closed]:pointer-events-none data-[state=closed]:hidden",
				className,
			),
		},
		...children,
	);
});
