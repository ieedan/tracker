import { type Child, type ComponentProps } from "@implementjs/core";
import { StarIcon } from "@implementjs/lucide";
import {
	RatingGroup as RatingGroupPrimitive,
	RatingGroupItem as RatingGroupItemPrimitive,
} from "@implementjs/primitives";
import { createComponent } from "@implementjs/primitives";
import { cn } from "@/lib/utils";

export type RatingGroupProps = ComponentProps<typeof RatingGroupPrimitive>;
export type RatingGroupItemProps = ComponentProps<typeof RatingGroupItemPrimitive>;

export const RatingGroup = createComponent(function RatingGroup(
	{ class: className, ...props }: RatingGroupProps,
	...children: Child[]
) {
	return RatingGroupPrimitive(
		{
			...props,
			"data-slot": "rating-group",
			class: cn(
				"flex w-fit items-center gap-1 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				className,
			),
		},
		...children,
	);
});

export const RatingGroupItem = createComponent(function RatingGroupItem(
	{ class: className, ...props }: RatingGroupItemProps,
	...children: Child[]
) {
	return RatingGroupItemPrimitive(
		{
			...props,
			"data-slot": "rating-group-item",
			class: cn(
				"group/rating-item cursor-pointer text-muted-foreground transition-colors",
				"data-[state=active]:text-primary",
				"data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
				"data-[readonly]:cursor-default",
				className,
			),
		},
		...(children.length > 0
			? children
			: [
					StarIcon({
						"aria-hidden": true,
						class: "size-5 group-data-[state=active]/rating-item:fill-current",
					}),
				]),
	);
});
