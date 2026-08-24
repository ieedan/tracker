import { ForEach, derived, Span, type Readable, type Signal, If, Div } from "@implementjs/core";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuCheckboxGroup } from "@/lib/components/ui/dropdown-menu"
import type { Label } from "@/lib/db/types";
import { TagPlusIcon } from "@implementjs/lucide";

export type LabelPickerProps = {
    value: Signal<number[]>;
    labels: Readable<Label[]>;
};

export function LabelPicker({ value, labels }: LabelPickerProps) {
    const selectedLabels = derived([labels, value], (labels, value) => labels.filter((l) => value.includes(l.id)));
    return DropdownMenu({},
        DropdownMenuTrigger({ variant: 'outline', class: 'h-8 px-3' },
            If(value.bind((v) => v.length === 0)).Then(
                TagPlusIcon({ class: "size-4" }),
                "Labels",
            )
            .ElseIf(value.bind((v) => v.length === 1)).Then(
                Span({
                    style: { backgroundColor: selectedLabels.bind((v) => v[0]!.color) },
                    class: "size-4 rounded-full shrink-0",
                }),
                selectedLabels.bind((v) => v[0]!.name),
            )
            .Else(
                Span(
                    { class: "inline-flex items-center gap-1" },
                    Div({ class: "flex flex-wrap -space-x-1" },
                        ForEach(selectedLabels, (item) => item.id, (label) =>
                            Span({
                                style: { backgroundColor: label.bind("color") },
                                class: "size-3 ring ring-background rounded-full shrink-0",
                            }),
                        ),
                    ),
                    selectedLabels.bind((v) => `${v.length} labels`),
                ),
            ),
        ),
        DropdownMenuContent({},
            DropdownMenuCheckboxGroup({ value: value.bind(v => v.map(v => v.toString()), (_, next) => next.map(Number)) },
                ForEach(labels, (item) => item.id, (item) => {
                    return DropdownMenuCheckboxItem({ closeOnSelect: false, value: item.get().id.toString() },
                        Span({ style: { backgroundColor: item.bind('color') }, class: 'size-4 rounded-full shrink-0' }),
                        Span({ class: 'text-nowrap whitespace-nowrap' }, item.bind('name'))
                    )
                }),
            )
        )
    );
}
