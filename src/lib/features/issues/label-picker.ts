import {
	ForEach,
	derived,
	Span,
	type Readable,
	type Signal,
	If,
	Div,
	type Child,
	context,
} from "@implementjs/core";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	DropdownMenuCheckboxItem,
	DropdownMenuCheckboxGroup,
	type DropdownMenuTriggerProps,
} from "@/lib/components/ui/dropdown-menu";
import type { Label } from "@/lib/db/types";
import { PlusIcon, TagPlusIcon } from "@implementjs/lucide";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/lib/components/ui/checkbox";
import { createComponent } from "@implementjs/primitives";

export type LabelPickerContextValue = {
	value: Signal<number[]>;
	labels: Readable<Label[]>;
	align: "start" | "end" | "center";
};

export const LabelPickerContext = context<LabelPickerContextValue>("LabelPicker");

export type LabelPickerProps = {
	value: Signal<number[]>;
	labels: Readable<Label[]>;
	align?: "start" | "end" | "center";
};

export function LabelPicker(
	{ value, labels, align = "start" }: LabelPickerProps,
	...children: Child[]
) {
	return LabelPickerContext.Provide({ value, labels, align }).To(
		DropdownMenu(
			...(children.length > 0 ? children : [LabelPickerTrigger()]),
			LabelPickerContent(),
		),
	);
}

export type LabelPickerTriggerProps = DropdownMenuTriggerProps;

export const LabelPickerTrigger = createComponent(function LabelPickerTrigger(
	{ variant = "outline", class: className, ...props }: LabelPickerTriggerProps,
	...children: Child[]
) {
	return LabelPickerContext.Use(({ value, labels }) => {
		if (children.length > 0) {
			return DropdownMenuTrigger({ variant, class: className, ...props }, ...children);
		}

		const selectedLabels = derived([labels, value], (labels, value) =>
			labels.filter((label) => value.includes(label.id)),
		);

		return DropdownMenuTrigger(
			{ variant, class: cn("h-8 px-3 justify-start", className), ...props },
			If(value.bind((v) => v.length === 0))
				.Then(TagPlusIcon({ class: "size-4" }), "Labels")
				.ElseIf(value.bind((v) => v.length === 1))
				.Then(
					Span({
						style: { backgroundColor: selectedLabels.bind((v) => v[0]!.color) },
						class: "size-4 rounded-full shrink-0",
					}),
					selectedLabels.bind((v) => v[0]!.name),
				)
				.Else(
					Span(
						{ class: "inline-flex items-center gap-1" },
						Div(
							{ class: "flex flex-wrap -space-x-1" },
							ForEach(
								selectedLabels,
								(item) => item.id,
								(label) =>
									Span({
										style: { backgroundColor: label.bind("color") },
										class: "size-3 ring ring-background rounded-full shrink-0",
									}),
							),
						),
						selectedLabels.bind((v) => `${v.length} labels`),
					),
				),
		);
	});
});

export function LabelPickerContent() {
	return LabelPickerContext.Use(({ value, labels, align }) =>
		DropdownMenuContent(
			{ align },
			DropdownMenuCheckboxGroup(
				{
					value: value.bind(
						(v) => v.map((v) => v.toString()),
						(_, next) => next.map(Number),
					),
				},
				ForEach(
					labels,
					(item) => item.id,
					(item) =>
						DropdownMenuCheckboxItem(
							{
								closeOnSelect: true,
								value: item.get().id.toString(),
								noIndicator: true,
							},
							Checkbox({
								checked: value.bind(
									(v) => v.includes(item.get().id),
									(_, next) => {
										if (next) {
											value.push(item.get().id);
										} else {
											value.set(value.get().filter((v) => v !== item.get().id));
										}
									},
								),
								onClick: (e) => e.stopPropagation(),
							}),
							Span({
								style: { backgroundColor: item.bind("color") },
								class: "size-4 rounded-full shrink-0",
							}),
							Span({ class: "text-nowrap whitespace-nowrap" }, item.bind("name")),
						),
				),
			),
		),
	);
}

const labelBadgeClass =
	"inline-flex items-center gap-1 border border-border rounded-full px-2 py-1 bg-accent/50";

function LabelBadgeParts(label: Readable<Label>): Child[] {
	return [
		Span({
			style: { backgroundColor: label.bind("color") },
			class: "size-3 rounded-full shrink-0",
		}),
		Span({ class: "text-nowrap whitespace-nowrap text-sm" }, label.bind("name")),
	];
}

export function LabelBadge(label: Readable<Label>) {
	return LabelPickerContext.UseOr((ctx) => {
		if (ctx === null) {
			return Div({ class: labelBadgeClass }, ...LabelBadgeParts(label));
		}

		return DropdownMenuTrigger(
			{
				variant: "outline",
				class: cn(labelBadgeClass, "h-auto shadow-none font-normal"),
			},
			...LabelBadgeParts(label),
		);
	}, null);
}

export type LabelBadgeListProps = {
	labels: Readable<Label[]>;
	value: Signal<number[]>;
	class?: string;
	plusPosition?: "left" | "right";
};

export function LabelBadgeList({
	labels,
	class: className,
	plusPosition = "right",
	value,
}: LabelBadgeListProps) {
	return LabelPicker(
		{ value, labels, align: "end" },
		LabelBadgeListItems({ class: className, plusPosition }),
	);
}

function LabelBadgeListItems({
	class: className,
	plusPosition,
}: Pick<LabelBadgeListProps, "class" | "plusPosition">) {
	return LabelPickerContext.Use(({ value, labels }) => {
		const addTrigger = () =>
			LabelPickerTrigger(
				{
					variant: "outline",
					size: "icon",
					class: "rounded-full",
					"aria-label": "Add labels",
				},
				PlusIcon({ class: "size-4" }),
			);

		return Div(
			{ class: cn("flex flex-wrap gap-2", className) },
			If(plusPosition === "left").Then(addTrigger()),
			ForEach(
				value,
				(item) => item,
				(labelId) => {
					const currentLabel = derived([labels, labelId], (labels, labelId) =>
						labels.find((label) => label.id === labelId)!,
					);
					return LabelBadge(currentLabel);
				},
			),
			If(plusPosition === "right").Then(addTrigger()),
		);
	});
}
