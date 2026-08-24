import type { Child, ComponentProps } from "@implementjs/core";
import {
	LinkPreview as LinkPreviewPrimitive,
	LinkPreviewContent as LinkPreviewContentPrimitive,
	LinkPreviewPortal as LinkPreviewPortalPrimitive,
	LinkPreviewTrigger as LinkPreviewTriggerPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type LinkPreviewProps = ComponentProps<typeof LinkPreviewPrimitive>;
export type LinkPreviewTriggerProps = ComponentProps<typeof LinkPreviewTriggerPrimitive>;
export type LinkPreviewContentProps = ComponentProps<typeof LinkPreviewContentPrimitive>;

export const LinkPreviewPortal = LinkPreviewPortalPrimitive;

export const LinkPreview = createComponent(function LinkPreview(
	props: LinkPreviewProps,
	...children: Child[]
) {
	return LinkPreviewPrimitive(props, ...children);
});

export const LinkPreviewTrigger = createComponent(function LinkPreviewTrigger(
	{ class: className, ...props }: LinkPreviewTriggerProps,
	...children: Child[]
) {
	return LinkPreviewTriggerPrimitive(
		{
			...props,
			"data-slot": "link-preview-trigger",
			class: cn(
				"rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				className,
			),
		},
		...children,
	);
});

export const LinkPreviewContent = createComponent(function LinkPreviewContent(
	{
		offset = 8,
		side = "top",
		align = "center",
		class: className,
		...props
	}: LinkPreviewContentProps,
	...children: Child[]
) {
	return LinkPreviewContentPrimitive(
		{
			...props,
			"data-slot": "link-preview-content",
			offset,
			side,
			align,
			class: cn(
				"absolute z-50 w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
				"origin-(--ip-link-preview-content-transform-origin)",
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
