import { Div, ForEach, Fragment, type Readable } from "@implementjs/core";
import { ChevronLeftIcon, ChevronRightIcon } from "@implementjs/lucide";
import {
	Calendar as CalendarPrimitive,
	CalendarCell,
	CalendarDay,
	CalendarGrid,
	CalendarGridBody,
	CalendarGridHead,
	CalendarGridRow,
	CalendarHeadCell,
	CalendarHeader,
	CalendarHeading,
	CalendarNextButton,
	CalendarPrevButton,
	type CalendarRootProps,
	type Month,
} from "@implementjs/primitives";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";
import { createComponent } from "@implementjs/primitives";

export type CalendarProps = CalendarRootProps | CalendarRootProps<"multiple">;

export function CalendarNav() {
	return CalendarHeader(
		{ class: "flex items-center justify-between" },
		CalendarPrevButton(
			{ class: buttonVariants({ variant: "ghost", size: "icon-sm" }) },
			ChevronLeftIcon({ "aria-hidden": true, class: "size-4" }),
		),
		CalendarHeading({ class: "text-sm font-medium" }),
		CalendarNextButton(
			{ class: buttonVariants({ variant: "ghost", size: "icon-sm" }) },
			ChevronRightIcon({ "aria-hidden": true, class: "size-4" }),
		),
	);
}

export function CalendarMonthGrid(
	month: Readable<Month>,
	weekdays: Readable<string[]>,
	Cell: typeof CalendarCell = CalendarCell,
	Day: typeof CalendarDay = CalendarDay,
) {
	return CalendarGrid(
		{ class: "w-full border-collapse" },
		CalendarGridHead(
			{},
			CalendarGridRow(
				{ class: "flex" },
				ForEach(
					weekdays,
					(_, i) => i,
					(weekday) =>
						CalendarHeadCell(
							{ class: "w-8 rounded-md text-[0.8rem] font-normal text-muted-foreground" },
							weekday,
						),
				),
			),
		),
		CalendarGridBody(
			{},
			ForEach(
				month.bind((m) => m.weeks),
				(week) => week[0]!.toString(),
				(week) =>
					CalendarGridRow(
						{ class: "mt-1 flex w-full" },
						ForEach(
							week,
							(date) => date.toString(),
							(date) =>
								Cell(
									{ date, month, class: "p-0" },
									Day({
										class: cn(
											"inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-sm font-normal whitespace-nowrap select-none",
											"outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
											"data-today:not-data-selected:bg-accent data-today:not-data-selected:text-accent-foreground",
											"data-selected:bg-primary data-selected:text-primary-foreground data-selected:hover:bg-primary",
											"data-outside-month:text-muted-foreground",
											"data-disabled:pointer-events-none data-disabled:text-muted-foreground data-disabled:opacity-50",
											"data-unavailable:text-muted-foreground data-unavailable:line-through",
										),
									}),
								),
						),
					),
			),
		),
	);
}

/** A fully assembled, styled calendar. Forward any root prop from the primitive. */
export const Calendar = createComponent(function Calendar({
	class: className,
	...props
}: CalendarProps) {
	return CalendarPrimitive(
		{
			...props,
			class: cn("inline-block rounded-md border bg-background p-3 shadow-sm", className),
		},
		({ months, weekdays }) =>
			Fragment(
				CalendarNav(),
				Div(
					{ class: "mt-3 flex flex-col gap-4 md:flex-row" },
					ForEach(
						months,
						(month) => month.value.toString(),
						(month) => CalendarMonthGrid(month, weekdays),
					),
				),
			),
	);
});
