import { Span, type Child, type ComponentProps } from "@implementjs/core";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "@implementjs/lucide";
import {
	DropdownMenu as DropdownMenuPrimitive,
	DropdownMenuCheckboxGroup as DropdownMenuCheckboxGroupPrimitive,
	DropdownMenuCheckboxItem as DropdownMenuCheckboxItemPrimitive,
	DropdownMenuContent as DropdownMenuContentPrimitive,
	DropdownMenuGroup as DropdownMenuGroupPrimitive,
	DropdownMenuGroupHeading as DropdownMenuGroupHeadingPrimitive,
	DropdownMenuItem as DropdownMenuItemPrimitive,
	DropdownMenuRadioGroup as DropdownMenuRadioGroupPrimitive,
	DropdownMenuRadioItem as DropdownMenuRadioItemPrimitive,
	DropdownMenuSeparator as DropdownMenuSeparatorPrimitive,
	DropdownMenuSub as DropdownMenuSubPrimitive,
	DropdownMenuSubContent as DropdownMenuSubContentPrimitive,
	DropdownMenuSubTrigger as DropdownMenuSubTriggerPrimitive,
	DropdownMenuTrigger as DropdownMenuTriggerPrimitive,
} from "@implementjs/primitives";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "../../utils";
import { createComponent } from "@implementjs/primitives";

// no overflow clipping: sub-content panels render nested inside and extend past this box
export const menuPanelBaseClasses =
	"absolute z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none";

/** Panels that pop in without animation — submenus, which should feel instant. */
export const menuStaticPanelClasses = [
	menuPanelBaseClasses,
	"data-[state=open]:block",
	"data-[state=closed]:pointer-events-none data-[state=closed]:hidden",
].join(" ");

export const menuContentClasses = [
	menuPanelBaseClasses,
	"transition-[opacity,translate,scale,display] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] transition-discrete motion-reduce:transition-none",
	"data-[state=open]:block data-[state=open]:translate-0 data-[state=open]:scale-100 data-[state=open]:opacity-100",
	"data-[state=closed]:pointer-events-none data-[state=closed]:hidden data-[state=closed]:scale-95 data-[state=closed]:opacity-0",
	"data-[state=closed]:data-[side=bottom]:-translate-y-2 data-[state=closed]:data-[side=top]:translate-y-2 data-[state=closed]:data-[side=left]:translate-x-2 data-[state=closed]:data-[side=right]:-translate-x-2",
	"starting:data-[state=open]:opacity-0 starting:data-[state=open]:scale-95",
	"starting:data-[state=open]:data-[side=bottom]:-translate-y-2 starting:data-[state=open]:data-[side=top]:translate-y-2 starting:data-[state=open]:data-[side=left]:translate-x-2 starting:data-[state=open]:data-[side=right]:-translate-x-2",
].join(" ");

export const menuItemClasses = [
	"relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none",
	"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
	"data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
	"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(" ");

export const menuIndicatorItemClasses = "py-1.5 pr-2 pl-8";

export const menuIndicatorClasses =
	"pointer-events-none absolute left-2 flex size-3.5 items-center justify-center";

export const menuGroupHeadingClasses = "px-2 py-1.5 text-xs font-medium text-muted-foreground";

export const menuSeparatorClasses = "-mx-1 my-1 h-px bg-border";

export const menuSubTriggerClasses =
	"data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";

/** The chevron a sub trigger ends with. */
export function MenuSubTriggerChevron(): Child {
	return ChevronRightIcon({ "aria-hidden": true, class: "ml-auto size-4" });
}

/** The check shown by checkbox items while checked. */
export function MenuCheckIndicator(): Child {
	return Span(
		{ "data-slot": "menu-item-indicator", class: menuIndicatorClasses },
		CheckIcon({
			"aria-hidden": true,
			class: "size-4 hidden group-data-[state=checked]/menu-item:block",
		}),
	);
}

/** The dot shown by radio items while checked. */
export function MenuRadioIndicator(): Child {
	return Span(
		{ "data-slot": "menu-item-indicator", class: menuIndicatorClasses },
		CircleIcon({
			"aria-hidden": true,
			class: "size-2 hidden fill-current group-data-[state=checked]/menu-item:block",
		}),
	);
}

export type DropdownMenuProps = ComponentProps<typeof DropdownMenuPrimitive>;
export const DropdownMenu = DropdownMenuPrimitive;

export type DropdownMenuTriggerProps = ComponentProps<typeof DropdownMenuTriggerPrimitive> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
};

export const DropdownMenuTrigger = createComponent(function DropdownMenuTrigger(
	{ class: className, variant = "outline", size = "default", ...props }: DropdownMenuTriggerProps,
	...children: Child[]
) {
	return DropdownMenuTriggerPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-trigger",
			"data-variant": variant,
			"data-size": size,
			class: cn(buttonVariants({ variant, size }), className),
		},
		...children,
	);
});

export type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuContentPrimitive>;

export const DropdownMenuContent = createComponent(function DropdownMenuContent(
	{ class: className, offset = 4, ...props }: DropdownMenuContentProps,
	...children: Child[]
) {
	return DropdownMenuContentPrimitive(
		{
			offset,
			...props,
			"data-slot": "dropdown-menu-content",
			class: cn(
				menuContentClasses,
				"origin-(--ip-dropdown-menu-content-transform-origin)",
				className,
			),
		},
		...children,
	);
});

export type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuItemPrimitive>;

export const DropdownMenuItem = createComponent(function DropdownMenuItem(
	{ class: className, ...props }: DropdownMenuItemProps,
	...children: Child[]
) {
	return DropdownMenuItemPrimitive(
		{ ...props, "data-slot": "dropdown-menu-item", class: cn(menuItemClasses, className) },
		...children,
	);
});

export type DropdownMenuCheckboxGroupProps = ComponentProps<
	typeof DropdownMenuCheckboxGroupPrimitive
>;
export const DropdownMenuCheckboxGroup = DropdownMenuCheckboxGroupPrimitive;

export type DropdownMenuCheckboxItemProps = ComponentProps<
	typeof DropdownMenuCheckboxItemPrimitive
>;

export const DropdownMenuCheckboxItem = createComponent(function DropdownMenuCheckboxItem(
	{ class: className, ...props }: DropdownMenuCheckboxItemProps,
	...children: Child[]
) {
	return DropdownMenuCheckboxItemPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-checkbox-item",
			class: cn("group/menu-item", menuItemClasses, menuIndicatorItemClasses, className),
		},
		MenuCheckIndicator(),
		...children,
	);
});

export type DropdownMenuRadioGroupProps = ComponentProps<typeof DropdownMenuRadioGroupPrimitive>;
export const DropdownMenuRadioGroup = DropdownMenuRadioGroupPrimitive;

export type DropdownMenuRadioItemProps = ComponentProps<typeof DropdownMenuRadioItemPrimitive>;

export const DropdownMenuRadioItem = createComponent(function DropdownMenuRadioItem(
	{ class: className, ...props }: DropdownMenuRadioItemProps,
	...children: Child[]
) {
	return DropdownMenuRadioItemPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-radio-item",
			class: cn("group/menu-item", menuItemClasses, menuIndicatorItemClasses, className),
		},
		MenuRadioIndicator(),
		...children,
	);
});

export type DropdownMenuGroupProps = ComponentProps<typeof DropdownMenuGroupPrimitive>;
export const DropdownMenuGroup = DropdownMenuGroupPrimitive;

export type DropdownMenuGroupHeadingProps = ComponentProps<
	typeof DropdownMenuGroupHeadingPrimitive
>;

export const DropdownMenuGroupHeading = createComponent(function DropdownMenuGroupHeading(
	{ class: className, ...props }: DropdownMenuGroupHeadingProps,
	...children: Child[]
) {
	return DropdownMenuGroupHeadingPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-group-heading",
			class: cn(menuGroupHeadingClasses, className),
		},
		...children,
	);
});

export type DropdownMenuSeparatorProps = ComponentProps<typeof DropdownMenuSeparatorPrimitive>;

export const DropdownMenuSeparator = createComponent(function DropdownMenuSeparator({
	class: className,
	...props
}: DropdownMenuSeparatorProps) {
	return DropdownMenuSeparatorPrimitive({
		...props,
		"data-slot": "dropdown-menu-separator",
		class: cn(menuSeparatorClasses, className),
	});
});

export type DropdownMenuSubProps = ComponentProps<typeof DropdownMenuSubPrimitive>;
export const DropdownMenuSub = DropdownMenuSubPrimitive;

export type DropdownMenuSubTriggerProps = ComponentProps<typeof DropdownMenuSubTriggerPrimitive>;

export const DropdownMenuSubTrigger = createComponent(function DropdownMenuSubTrigger(
	{ class: className, ...props }: DropdownMenuSubTriggerProps,
	...children: Child[]
) {
	return DropdownMenuSubTriggerPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-sub-trigger",
			class: cn(menuItemClasses, menuSubTriggerClasses, className),
		},
		...children,
		MenuSubTriggerChevron(),
	);
});

export type DropdownMenuSubContentProps = ComponentProps<typeof DropdownMenuSubContentPrimitive>;

export const DropdownMenuSubContent = createComponent(function DropdownMenuSubContent(
	{ class: className, offset = 8, ...props }: DropdownMenuSubContentProps,
	...children: Child[]
) {
	return DropdownMenuSubContentPrimitive(
		{
			offset,
			...props,
			"data-slot": "dropdown-menu-sub-content",
			class: cn(menuStaticPanelClasses, className),
		},
		...children,
	);
});
