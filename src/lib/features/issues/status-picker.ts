import { Dynamic, Span, type Signal } from "@implementjs/core";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/lib/components/ui/select";
import { ISSUE_STATUSES, type Status } from "@/lib/constants";

export type StatusPickerProps = {
    value: Signal<Status>;
};

export function StatusPicker({ value }: StatusPickerProps) {
    return Select({ type: "single", value },
        SelectTrigger({ class: 'h-8 px-3', noIcon: true },
            Dynamic([value], (value) => ISSUE_STATUSES[value].icon()),
            value
        ),
        SelectContent({},
            ...Object.entries(ISSUE_STATUSES).map(([key, value]) =>
                SelectItem({ value: key, class: '[&_svg]:size-4 [&_svg]:inline flex items-center gap-2' }, 
                    value.icon(), 
                    Span({ class: 'text-nowrap whitespace-nowrap' }, key)
                )
            )
        )
    );
}
