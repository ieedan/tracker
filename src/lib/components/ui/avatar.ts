import type { Child, ComponentProps } from "@implementjs/core";
import {
	Avatar as AvatarPrimitive,
	AvatarFallback as AvatarFallbackPrimitive,
	AvatarImage as AvatarImagePrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "../../utils";

export type AvatarProps = ComponentProps<typeof AvatarPrimitive>;
export type AvatarImageProps = ComponentProps<typeof AvatarImagePrimitive>;
export type AvatarFallbackProps = ComponentProps<typeof AvatarFallbackPrimitive>;

export const Avatar = createComponent(function Avatar(
	{ class: className, ...props }: AvatarProps,
	...children: Child[]
) {
	return AvatarPrimitive(
		{
			...props,
			"data-slot": "avatar",
			class: cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className),
		},
		...children,
	);
});

export const AvatarImage = createComponent(function AvatarImage({
	class: className,
	...props
}: AvatarImageProps) {
	return AvatarImagePrimitive({
		...props,
		"data-slot": "avatar-image",
		class: cn("aspect-square size-full", className),
	});
});

export const AvatarFallback = createComponent(function AvatarFallback(
	{ class: className, ...props }: AvatarFallbackProps,
	...children: Child[]
) {
	return AvatarFallbackPrimitive(
		{
			...props,
			"data-slot": "avatar-fallback",
			class: cn("flex size-full items-center justify-center rounded-full bg-muted", className),
		},
		...children,
	);
});
