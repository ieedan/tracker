import { Div, Dynamic, If, Span, type Signal } from "@implementjs/core";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/lib/components/ui/select";
import { ISSUE_PRIORITIES, type Priority } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type PriorityPickerProps = {
    value: Signal<Priority>;
    showLabel?: boolean;
    class?: string;
    onChange?: (value: Priority) => void;
};

export function PriorityPicker({ value, showLabel = true, class: className, onChange }: PriorityPickerProps) {
    return Select({ type: "single", value },
        SelectTrigger({ noIcon: true, class: cn('h-8 px-3 w-fit shrink-0', className) },
            Div({ class: 'flex items-center gap-2' },
                Dynamic([value], (value) => ISSUE_PRIORITIES[value].icon()),
                If(showLabel).Then(Span({ class: 'text-nowrap whitespace-nowrap' }, value)),
            ),
        ),
        SelectContent({},
            ...Object.entries(ISSUE_PRIORITIES).map(([key, value]) =>
                SelectItem({ value: key, class: '[&_svg]:size-4 [&_svg]:inline flex items-center gap-2' },
                    value.icon(),
                    Span({ class: 'text-nowrap whitespace-nowrap' }, key)
                )
            )
        )
    );
}
