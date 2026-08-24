import { Div, ForEach, Fragment } from "@implementjs/core";
import { ChevronLeftIcon, ChevronRightIcon } from "@implementjs/lucide";
import {
	RangeCalendar as RangeCalendarPrimitive,
	RangeCalendarCell,
	RangeCalendarDay,
	RangeCalendarGrid,
	RangeCalendarGridBody,
	RangeCalendarGridHead,
	RangeCalendarGridRow,
	RangeCalendarHeadCell,
	RangeCalendarHeader,
	RangeCalendarHeading,
	RangeCalendarNextButton,
	RangeCalendarPrevButton,
	type RangeCalendarRootProps,
} from "@implementjs/primitives";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";
import { createComponent } from "@implementjs/primitives";

export type RangeCalendarProps = RangeCalendarRootProps;

/** A fully assembled, styled range calendar. Forward any root prop from the primitive. */
export const RangeCalendar = createComponent(function RangeCalendar({
	class: className,
	...props
}: RangeCalendarProps) {
	return RangeCalendarPrimitive(
		{
			...props,
			class: cn("inline-block rounded-md border bg-background p-3 shadow-sm", className),
		},
		({ months, weekdays }) =>
			Fragment(
				RangeCalendarHeader(
					{ class: "flex items-center justify-between" },
					RangeCalendarPrevButton(
						{ class: buttonVariants({ variant: "ghost", size: "icon-sm" }) },
						ChevronLeftIcon({ "aria-hidden": true, class: "size-4" }),
					),
					RangeCalendarHeading({ class: "text-sm font-medium" }),
					RangeCalendarNextButton(
						{ class: buttonVariants({ variant: "ghost", size: "icon-sm" }) },
						ChevronRightIcon({ "aria-hidden": true, class: "size-4" }),
					),
				),
				Div(
					{ class: "mt-3 flex flex-col gap-4 md:flex-row" },
					ForEach(
						months,
						(month) => month.value.toString(),
						(month) =>
							RangeCalendarGrid(
								{ class: "w-full border-collapse" },
								RangeCalendarGridHead(
									{},
									RangeCalendarGridRow(
										{ class: "flex" },
										ForEach(
											weekdays,
											(_, i) => i,
											(weekday) =>
												RangeCalendarHeadCell(
													{
														class: "w-8 rounded-md text-[0.8rem] font-normal text-muted-foreground",
													},
													weekday,
												),
										),
									),
								),
								RangeCalendarGridBody(
									{},
									ForEach(
										month.bind((m) => m.weeks),
										(week) => week[0]!.toString(),
										(week) =>
											RangeCalendarGridRow(
												{ class: "mt-1 flex w-full" },
												ForEach(
													week,
													(date) => date.toString(),
													(date) =>
														RangeCalendarCell(
															{ date, month, class: "p-0" },
															RangeCalendarDay({
																class: cn(
																	"inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-sm font-normal whitespace-nowrap select-none",
																	"outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
																	"data-today:not-data-selected:not-data-highlighted:bg-accent data-today:not-data-selected:not-data-highlighted:text-accent-foreground",
																	"data-highlighted:not-data-selection-start:not-data-selection-end:rounded-none data-highlighted:not-data-selection-start:not-data-selection-end:bg-accent data-highlighted:not-data-selection-start:not-data-selection-end:text-accent-foreground",
																	"data-range-middle:rounded-none data-range-middle:bg-accent data-range-middle:text-accent-foreground",
																	"data-selection-start:rounded-md data-selection-start:bg-primary data-selection-start:text-primary-foreground data-selection-start:hover:bg-primary",
																	"data-selection-end:rounded-md data-selection-end:bg-primary data-selection-end:text-primary-foreground data-selection-end:hover:bg-primary",
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
							),
					),
				),
			),
	);
});
