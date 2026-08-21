import { Div, Fieldset, Legend, P, type Child, type ElementProps } from "@implementjs/core";
import { createComponent } from "@implementjs/primitives";
import { tv, type VariantProps } from "tailwind-variants";
import { Label } from "./label";
import { Separator } from "./separator";
import { cn } from "../../utils";

export const fieldVariants = tv({
	base: "group/field flex w-full gap-3 data-[invalid=true]:text-destructive",
	variants: {
		orientation: {
			vertical: "flex-col [&>*]:w-full [&>.sr-only]:w-auto",
			horizontal: [
				"flex-row items-center",
				"[&>[data-slot=field-label]]:flex-auto",
				"has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
			],
			responsive: [
				"flex-col @md/field-group:flex-row @md/field-group:items-center [&>*]:w-full @md/field-group:[&>*]:w-auto",
				"@md/field-group:[&>[data-slot=field-label]]:flex-auto",
				"@md/field-group:has-[>[data-slot=field-content]]:items-start",
			],
		},
	},
	defaultVariants: { orientation: "vertical" },
});

export const fieldLegendVariants = tv({
	base: "mb-3 font-medium",
	variants: {
		variant: {
			legend: "text-base",
			label: "text-sm",
		},
	},
	defaultVariants: { variant: "legend" },
});

export type FieldOrientation = VariantProps<typeof fieldVariants>["orientation"];
export type FieldLegendVariant = VariantProps<typeof fieldLegendVariants>["variant"];

export type FieldSetProps = ElementProps<"fieldset">;
export type FieldLegendProps = ElementProps<"legend"> & VariantProps<typeof fieldLegendVariants>;
export type FieldGroupProps = ElementProps<"div">;
export type FieldProps = ElementProps<"div"> & VariantProps<typeof fieldVariants>;
export type FieldContentProps = ElementProps<"div">;
export type FieldLabelProps = ElementProps<"label">;
export type FieldTitleProps = ElementProps<"div">;
export type FieldDescriptionProps = ElementProps<"p">;
export type FieldSeparatorProps = ElementProps<"div">;
export type FieldErrorProps = ElementProps<"div">;

/** A group of related fields, with a `FieldLegend` naming it. */
export const FieldSet = createComponent(function FieldSet(
	{ class: className, ...props }: FieldSetProps,
	...children: Child[]
) {
	return Fieldset(
		{
			...props,
			"data-slot": "field-set",
			class: cn(
				"flex flex-col gap-6",
				"has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
				className,
			),
		},
		...children,
	);
});

export const FieldLegend = createComponent(function FieldLegend(
	{ class: className, variant = "legend", ...props }: FieldLegendProps,
	...children: Child[]
) {
	return Legend(
		{
			...props,
			"data-slot": "field-legend",
			"data-variant": variant,
			class: cn(fieldLegendVariants({ variant }), className),
		},
		...children,
	);
});

/**
 * The column a form's fields sit in. It is a `@container`, which is what the
 * `responsive` orientation measures — so a field goes side-by-side when the
 * form is wide enough, regardless of how wide the window is.
 */
export const FieldGroup = createComponent(function FieldGroup(
	{ class: className, ...props }: FieldGroupProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "field-group",
			class: cn(
				"@container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3",
				"[&>[data-slot=field-group]]:gap-4",
				className,
			),
		},
		...children,
	);
});

/**
 * One control and everything that describes it. `data-invalid` on the field
 * turns the whole thing destructive at once, rather than each part having to
 * be told separately.
 */
export const Field = createComponent(function Field(
	{ class: className, orientation = "vertical", ...props }: FieldProps,
	...children: Child[]
) {
	return Div(
		{
			role: "group",
			...props,
			"data-slot": "field",
			"data-orientation": orientation,
			class: cn(fieldVariants({ orientation }), className),
		},
		...children,
	);
});

/** Title and description together, for a horizontal field with a control beside them. */
export const FieldContent = createComponent(function FieldContent(
	{ class: className, ...props }: FieldContentProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "field-content",
			class: cn("group/field-content flex flex-1 flex-col gap-1.5 leading-snug", className),
		},
		...children,
	);
});

/**
 * The field's label. It wraps [Label](/ui/label), and adds the layout rules
 * for a label that has a whole control nested inside it — a checkbox row,
 * say, where the label is the click target for the box next to it.
 */
export const FieldLabel = createComponent(function FieldLabel(
	{ class: className, ...props }: FieldLabelProps,
	...children: Child[]
) {
	return Label(
		{
			...props,
			"data-slot": "field-label",
			class: cn(
				"group/field-label flex w-fit gap-2 leading-snug",
				"group-data-[disabled=true]/field:opacity-50",
				"has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border has-[>[data-slot=field]]:p-4",
				"has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5",
				className,
			),
		},
		...children,
	);
});

/** A heading inside a label that wraps a control. */
export const FieldTitle = createComponent(function FieldTitle(
	{ class: className, ...props }: FieldTitleProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "field-title",
			class: cn(
				"flex w-fit items-center gap-2 text-sm leading-snug font-medium",
				"group-data-[disabled=true]/field:opacity-50",
				className,
			),
		},
		...children,
	);
});

export const FieldDescription = createComponent(function FieldDescription(
	{ class: className, ...props }: FieldDescriptionProps,
	...children: Child[]
) {
	return P(
		{
			...props,
			"data-slot": "field-description",
			class: cn(
				"text-sm leading-normal font-normal text-muted-foreground",
				"group-has-[[data-orientation=horizontal]]/field:text-balance",
				"last:mt-0 nth-last-2:-mt-1",
				"[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
				className,
			),
		},
		...children,
	);
});

/** A rule between fields, optionally with a word sitting on it. */
export const FieldSeparator = createComponent(function FieldSeparator(
	{ class: className, ...props }: FieldSeparatorProps,
	...children: Child[]
) {
	return Div(
		{
			...props,
			"data-slot": "field-separator",
			"data-content": children.length > 0 ? "" : undefined,
			class: cn(
				"relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
				className,
			),
		},
		Separator({ class: "absolute inset-0 top-1/2" }),
		...(children.length > 0
			? [
					Div(
						{
							class: "relative mx-auto block w-fit bg-background px-2 text-muted-foreground",
							"data-slot": "field-separator-content",
						},
						...children,
					),
				]
			: []),
	);
});

/**
 * What is wrong with the field. Give the control `aria-invalid` and the
 * field `data-invalid="true"` so the styling and the announcement agree;
 * rendering nothing when there is no error keeps the layout from jumping.
 */
export const FieldError = createComponent(function FieldError(
	{ class: className, ...props }: FieldErrorProps,
	...children: Child[]
) {
	return Div(
		{
			role: "alert",
			...props,
			"data-slot": "field-error",
			class: cn("text-sm font-normal text-destructive", className),
		},
		...children,
	);
});
