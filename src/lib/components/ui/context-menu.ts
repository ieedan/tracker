import { Span, type Child, type ComponentProps } from "@implementjs/core";
import { CheckIcon, ChevronRightIcon } from "@implementjs/lucide";
import {
	ContextMenu as ContextMenuPrimitive,
	ContextMenuCheckboxGroup as ContextMenuCheckboxGroupPrimitive,
	ContextMenuCheckboxItem as ContextMenuCheckboxItemPrimitive,
	ContextMenuContent as ContextMenuContentPrimitive,
	ContextMenuGroup as ContextMenuGroupPrimitive,
	ContextMenuGroupHeading as ContextMenuGroupHeadingPrimitive,
	ContextMenuItem as ContextMenuItemPrimitive,
	ContextMenuRadioGroup as ContextMenuRadioGroupPrimitive,
	ContextMenuRadioItem as ContextMenuRadioItemPrimitive,
	ContextMenuSeparator as ContextMenuSeparatorPrimitive,
	ContextMenuSub as ContextMenuSubPrimitive,
	ContextMenuSubContent as ContextMenuSubContentPrimitive,
	ContextMenuSubTrigger as ContextMenuSubTriggerPrimitive,
	ContextMenuTrigger as ContextMenuTriggerPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type ContextMenuProps = ComponentProps<typeof ContextMenuPrimitive>;
export const ContextMenu = ContextMenuPrimitive;

export type ContextMenuTriggerProps = ComponentProps<typeof ContextMenuTriggerPrimitive>;
export const ContextMenuTrigger = ContextMenuTriggerPrimitive;

export type ContextMenuContentProps = ComponentProps<typeof ContextMenuContentPrimitive>;

export const ContextMenuContent = createComponent(function ContextMenuContent(
	{ class: className, ...props }: ContextMenuContentProps,
	...children: Child[]
) {
	return ContextMenuContentPrimitive(
		{
			...props,
			"data-slot": "context-menu-content",
			// no overflow clipping: sub-content panels render nested inside and extend past this box
			class: cn(
				"absolute z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
				"origin-(--ip-context-menu-content-transform-origin)",
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

export type ContextMenuItemProps = ComponentProps<typeof ContextMenuItemPrimitive>;

export const ContextMenuItem = createComponent(function ContextMenuItem(
	{ class: className, ...props }: ContextMenuItemProps,
	...children: Child[]
) {
	return ContextMenuItemPrimitive(
		{
			...props,
			"data-slot": "context-menu-item",
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

export type ContextMenuCheckboxGroupProps = ComponentProps<
	typeof ContextMenuCheckboxGroupPrimitive
>;
export const ContextMenuCheckboxGroup = ContextMenuCheckboxGroupPrimitive;

export type ContextMenuCheckboxItemProps = ComponentProps<
	typeof ContextMenuCheckboxItemPrimitive
> & {
	/**
	 * The checked indicator, drawn in place of the default check. The left
	 * padding the default one is absolutely positioned into comes off with it:
	 * a custom indicator sits in the row's flow, so placing it is yours.
	 */
	indicator?: Child;
};

export const ContextMenuCheckboxItem = createComponent(function ContextMenuCheckboxItem(
	{ class: className, indicator, ...props }: ContextMenuCheckboxItemProps,
	...children: Child[]
) {
	return ContextMenuCheckboxItemPrimitive(
		{
			...props,
			"data-slot": "context-menu-checkbox-item",
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

export type ContextMenuRadioGroupProps = ComponentProps<typeof ContextMenuRadioGroupPrimitive>;
export const ContextMenuRadioGroup = ContextMenuRadioGroupPrimitive;

export type ContextMenuRadioItemProps = ComponentProps<typeof ContextMenuRadioItemPrimitive>;

export const ContextMenuRadioItem = createComponent(function ContextMenuRadioItem(
	{ class: className, ...props }: ContextMenuRadioItemProps,
	...children: Child[]
) {
	return ContextMenuRadioItemPrimitive(
		{
			...props,
			"data-slot": "context-menu-radio-item",
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

export type ContextMenuGroupProps = ComponentProps<typeof ContextMenuGroupPrimitive>;
export const ContextMenuGroup = ContextMenuGroupPrimitive;

export type ContextMenuGroupHeadingProps = ComponentProps<typeof ContextMenuGroupHeadingPrimitive>;

export const ContextMenuGroupHeading = createComponent(function ContextMenuGroupHeading(
	{ class: className, ...props }: ContextMenuGroupHeadingProps,
	...children: Child[]
) {
	return ContextMenuGroupHeadingPrimitive(
		{
			...props,
			"data-slot": "context-menu-group-heading",
			class: cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className),
		},
		...children,
	);
});

export type ContextMenuSeparatorProps = ComponentProps<typeof ContextMenuSeparatorPrimitive>;

export const ContextMenuSeparator = createComponent(function ContextMenuSeparator({
	class: className,
	...props
}: ContextMenuSeparatorProps) {
	return ContextMenuSeparatorPrimitive({
		...props,
		"data-slot": "context-menu-separator",
		class: cn("-mx-1 my-1 h-px bg-border", className),
	});
});

export type ContextMenuSubProps = ComponentProps<typeof ContextMenuSubPrimitive>;
export const ContextMenuSub = ContextMenuSubPrimitive;

export type ContextMenuSubTriggerProps = ComponentProps<typeof ContextMenuSubTriggerPrimitive>;

export const ContextMenuSubTrigger = createComponent(function ContextMenuSubTrigger(
	{ class: className, ...props }: ContextMenuSubTriggerProps,
	...children: Child[]
) {
	return ContextMenuSubTriggerPrimitive(
		{
			...props,
			"data-slot": "context-menu-sub-trigger",
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

export type ContextMenuSubContentProps = ComponentProps<typeof ContextMenuSubContentPrimitive>;

export const ContextMenuSubContent = createComponent(function ContextMenuSubContent(
	{ class: className, offset = 8, ...props }: ContextMenuSubContentProps,
	...children: Child[]
) {
	return ContextMenuSubContentPrimitive(
		{
			offset,
			...props,
			"data-slot": "context-menu-sub-content",
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
