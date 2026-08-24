import { Dynamic, If, Span, type Signal } from "@implementjs/core";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/lib/components/ui/select";
import { ISSUE_STATUSES, type Status } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type StatusPickerProps = {
    value: Signal<Status>;
    showLabel?: boolean;
    class?: string;
    onChange?: (value: Status) => void;
};

export function StatusPicker({ value, showLabel = true, class: className, onChange }: StatusPickerProps) {
    return Select({ type: "single", value },
        SelectTrigger({ class: cn('h-8 px-3', className), noIcon: true },
            Dynamic([value], (value) => ISSUE_STATUSES[value].icon()),
            If(showLabel).Then(Span({ class: 'text-nowrap whitespace-nowrap' }, value)),
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
