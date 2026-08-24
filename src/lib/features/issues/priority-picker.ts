import { Dynamic, Span, type Signal } from "@implementjs/core";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/lib/components/ui/select";
import { ISSUE_PRIORITIES, type Priority } from "@/lib/constants";

export type PriorityPickerProps = {
    value: Signal<Priority>;
};

export function PriorityPicker({ value }: PriorityPickerProps) {
    return Select({ type: "single", value },
        SelectTrigger({ noIcon: true, class: 'h-8 px-3' },
            Dynamic([value], (value) => ISSUE_PRIORITIES[value].icon()),
            value
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
