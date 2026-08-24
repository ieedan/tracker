import { derived, ForEach, Span, type Readable, type Signal } from "@implementjs/core";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/lib/components/ui/select";
import { cn } from "@/lib/utils";
import type { Team } from "@/lib/db/types";

export type TeamPickerProps = {
    value: Signal<number>;
    teams: Readable<Team[]>;
    class?: string;
    onChange?: (value: Team) => void;
};

export function TeamPicker({ value, teams, class: className, onChange }: TeamPickerProps) {
    const currentTeam = derived([teams, value], (teams, value) => teams.find((t) => t.id === value));
    return Select({ type: "single", value: value.bind((v) => Number(v), (_, next) => Number(next)) },
        SelectTrigger({ class: cn('h-8 px-3', className), noIcon: true },
            Span({ class: 'text-nowrap whitespace-nowrap' }, currentTeam.bind('shortHand')),
        ),
        SelectContent({},
            ForEach(teams, (item) => item.id, (team) =>
                SelectItem({ value: team.get().id.toString(), class: '[&_svg]:size-4 [&_svg]:inline flex items-center gap-2' },
                    team.bind('shortHand'),
                )
            )
        )
    );
}
