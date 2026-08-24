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
import { cn } from "@/lib/utils";
import { createComponent } from "@implementjs/primitives";

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
			// no overflow clipping: sub-content panels render nested inside and extend past this box
			class: cn(
				"absolute z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
				"origin-(--ip-dropdown-menu-content-transform-origin)",
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

export type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuItemPrimitive>;

export const DropdownMenuItem = createComponent(function DropdownMenuItem(
	{ class: className, ...props }: DropdownMenuItemProps,
	...children: Child[]
) {
	return DropdownMenuItemPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-item",
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

export type DropdownMenuCheckboxGroupProps = ComponentProps<
	typeof DropdownMenuCheckboxGroupPrimitive
>;
export const DropdownMenuCheckboxGroup = DropdownMenuCheckboxGroupPrimitive;

export type DropdownMenuCheckboxItemProps = ComponentProps<
	typeof DropdownMenuCheckboxItemPrimitive
> & {
	/**
	 * The checked indicator, drawn in place of the default check. The left
	 * padding the default one is absolutely positioned into comes off with it:
	 * a custom indicator sits in the row's flow, so placing it is yours.
	 */
	indicator?: Child;
};

export const DropdownMenuCheckboxItem = createComponent(function DropdownMenuCheckboxItem(
	{ class: className, indicator, ...props }: DropdownMenuCheckboxItemProps,
	...children: Child[]
) {
	return DropdownMenuCheckboxItemPrimitive(
		{
			...props,
			"data-slot": "dropdown-menu-checkbox-item",
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
			CircleIcon({
				"aria-hidden": true,
				class: "size-2 hidden fill-current group-data-[state=checked]/menu-item:block",
			}),
		),
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
			class: cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className),
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
		class: cn("-mx-1 my-1 h-px bg-border", className),
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
